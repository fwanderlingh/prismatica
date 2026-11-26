#!/usr/bin/env python3
"""Offline Prismatica host migration. No migration occurs without --execute.

Read migration/README.md before use. Python 3.8+; Linux/systemd/GNU tar.
All subprocesses run locally. This program never connects over SSH or changes IPs.
"""

import argparse
import datetime
import grp
import hashlib
import json
import os
from pathlib import Path
import platform
import pwd
import re
import shutil
import socket
import subprocess
import sys


VERSION = 1
ARTIFACTS = {
    "app.tar", "data.tar", "minio.tar", "caddy.tar", "host-config.tar",
    "minio-server", "database.dump", "row-counts.json", "inventory.json",
    "services.txt", "migration-config.json",
}
BROAD_PATHS = {
    "/", "/home", "/root", "/etc", "/usr", "/usr/local", "/var",
    "/var/lib", "/var/www", "/srv", "/opt", "/tmp", "/mnt", "/media",
}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(argv, capture=False, stdout=None):
    result = subprocess.run(
        [str(value) for value in argv], check=True,
        stdout=subprocess.PIPE if capture else stdout,
        text=capture,
    )
    return result.stdout.strip() if capture else None


def read_json(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path, value):
    with open(path, "x", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")


def checked_path(value):
    require(isinstance(value, str) and value.startswith("/"), "Paths must be absolute.")
    require(not any(ord(char) < 32 for char in value), "Control characters in path.")
    path = Path(value)
    require(".." not in path.parts, "Parent traversal in path: " + value)
    require(str(path) not in BROAD_PATHS, "Refusing overly broad path: " + value)
    return path


def inside(path, parent):
    return path == parent or parent in path.parents


def trees(config):
    result = [("app", checked_path(config["app_dir"]), config["app_user"], config["app_group"]),
              ("data", checked_path(config["data_dir"]), config["app_user"], config["app_group"])]
    for name in ("minio", "caddy"):
        section = config[name]
        if section["enabled"]:
            result.append((name, checked_path(section["data_dir"]), section["user"], section["group"]))
    return result


def units(config):
    return list(dict.fromkeys(config["app_units"] + [
        config[name]["unit"] for name in ("minio", "caddy") if config[name]["enabled"]
    ]))


def validate_config(config, executing=False):
    require(config["version"] == VERSION, "Unsupported configuration version.")
    require(isinstance(config["app_units"], list), "app_units must be an array of system service names.")
    require(isinstance(config["host_config_paths"], list), "host_config_paths must be an array of paths.")
    for name in ("minio", "caddy"):
        require(isinstance(config[name]["enabled"], bool), name + ".enabled must be a boolean.")
    configured_trees = trees(config)
    app, data = configured_trees[:2]
    require(app[1] != data[1] and not inside(app[1], data[1]), "data_dir cannot contain app_dir.")
    for index, (_, path, _, _) in enumerate(configured_trees):
        # Reject symlinked roots; use the physical absolute location on both PCs.
        require(path.resolve() == path, "Use a physical, normalized path: " + str(path))
        for other_index, (_, other, _, _) in enumerate(configured_trees[:index]):
            if index == 1 and other_index == 0:
                continue  # data/ inside the website is supported and archived separately.
            require(not inside(path, other) and not inside(other, path), "Overlapping data trees.")
    for value in config["host_config_paths"]:
        checked_path(value)
    for unit in units(config):
        require(re.fullmatch(r"[A-Za-z0-9_@.:-]+\.service", unit), "Invalid system service name.")
    db = config["database"]
    require(isinstance(db["enabled"], bool), "database.enabled must be a boolean.")
    if db["enabled"]:
        for field in ("name", "owner", "os_user"):
            require(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", db[field]), "Invalid database " + field)
        require(db["socket_dir"].startswith("/"), "PostgreSQL must use a local Unix socket.")
        require(isinstance(db["port"], int) and 0 < db["port"] < 65536, "Invalid PostgreSQL port.")
    if config["minio"]["enabled"]:
        checked_path(config["minio"]["binary"])
        require(config["minio"]["single_node_single_volume"] is True,
                "Only a complete offline single-node/single-volume MinIO clone is supported.")
    if executing:
        require("REPLACE_" not in json.dumps(config), "Fill in every REPLACE_ configuration value first.")
        require(config["source_hostname"] != config["target_hostname"], "Use distinct source/target hostnames.")


def require_host(config, restoring):
    field = "target_hostname" if restoring else "source_hostname"
    require(socket.gethostname() == config[field], "Wrong host; expected " + config[field])
    if restoring:
        addresses = json.loads(run(["ip", "-j", "-4", "address", "show"], capture=True))
        require(any(info.get("local") == config["staging_ip"]
                    for interface in addresses for info in interface.get("addr_info", [])),
                "Restore is allowed only while this PC has " + config["staging_ip"])


def outside_trees(path, config):
    path = path.resolve()
    for _, tree, _, _ in trees(config):
        require(not inside(path, tree) and not inside(tree, path),
                "Bundle/config staging must be separate from website and data trees.")
    for value in config["host_config_paths"]:
        tree = Path(value).resolve()
        require(not inside(path, tree) and not inside(tree, path),
                "Bundle/config staging must be separate from host_config_paths.")


def empty_directory(path):
    require(not path.is_symlink(), "Refusing a symlink destination: " + str(path))
    require(not path.exists() or (path.is_dir() and not any(path.iterdir())),
            "Destination must be absent or empty: " + str(path))


def unit_loaded(unit):
    # systemctl versions differ in the exit code returned for a missing unit.
    result = subprocess.run(["systemctl", "show", unit, "--property=LoadState", "--value"],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.stdout.strip() == "not-found":
        return False
    require(result.returncode == 0, "Cannot inspect system service: " + unit)
    return result.stdout.strip() == "loaded"


def stop_services(config, restoring=False):
    # Stop the application first so it cannot write while MinIO shuts down.
    for unit in units(config):
        if restoring and not unit_loaded(unit):
            continue  # Target service files are installed later from the staged configuration.
        print("Stopping " + unit, flush=True)
        run(["systemctl", "stop", unit])
        state = run(["systemctl", "show", unit, "--property=ActiveState", "--value"], capture=True)
        require(state in ("inactive", "failed"), unit + " has not stopped.")


def pg_command(config, command):
    db = config["database"]
    return ["runuser", "-u", db["os_user"], "--", command,
            "--host", db["socket_dir"], "--port", str(db["port"]),
            "--username", db["os_user"], "--dbname", db["name"], "--no-password"]


def sql(config, statement):
    return run(pg_command(config, "psql") + ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", statement], capture=True)


def relation_names(config):
    return sql(config, """
        SELECT quote_ident(n.nspname) || '.' || quote_ident(c.relname)
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r', 'p', 'm')
          AND n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
        ORDER BY 1
    """).splitlines()


def row_counts(config):
    return {name: int(sql(config, "SELECT count(*) FROM " + name)) for name in relation_names(config)}


def require_empty_database(config):
    require(sql(config, """
        SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
          AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
    """) == "0", "Target database must already exist and contain no user relations. Nothing was dropped.")


def archive_directory(source, output, exclusions=()):
    run(["tar", "--create", "--file", output, "--acls", "--xattrs", "--numeric-owner",
         *["--exclude=" + value for value in exclusions], "--directory", source, "."])


def extract(archive, destination):
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    run(["tar", "--extract", "--file", archive, "--directory", destination,
         "--acls", "--xattrs", "--numeric-owner", "--same-owner", "--delay-directory-restore"])


def digest(path):
    checksum = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def verify(bundle):
    manifest = read_json(bundle / "manifest.json")
    require(manifest["version"] == VERSION, "Unsupported backup version.")
    require({"app.tar", "data.tar", "host-config.tar", "migration-config.json", "inventory.json", "services.txt"}
            <= set(manifest["sha256"]), "Incomplete backup manifest.")
    for name, expected in manifest["sha256"].items():
        require(name in ARTIFACTS, "Unexpected backup artifact: " + name)
        path = bundle / name
        require(path.is_file() and not path.is_symlink(), "Missing/linked backup artifact: " + name)
        require(digest(path) == expected, "Checksum mismatch: " + name)
    config = read_json(bundle / "migration-config.json")
    required = set()
    if config["database"]["enabled"]:
        required.update(("database.dump", "row-counts.json"))
    if config["minio"]["enabled"]:
        required.update(("minio.tar", "minio-server"))
    if config["caddy"]["enabled"]:
        required.add("caddy.tar")
    require(required <= set(manifest["sha256"]), "Backup is missing configured storage artifacts.")
    print("All backup checksums match.", flush=True)
    return config


def export_backup(config, bundle):
    outside_trees(bundle, config)
    require(not bundle.exists(), "Choose a new bundle directory; existing backups are never overwritten.")
    for _, tree, _, _ in trees(config):
        require(tree.is_dir(), "Missing source directory: " + str(tree))
    for path in config["host_config_paths"]:
        require(Path(path).exists(), "Missing configured host file/directory: " + path)
    for unit in units(config):
        require(unit_loaded(unit), "Missing source service: " + unit)
    if config["database"]["enabled"]:
        sql(config, "SELECT 1")  # Check authentication before stopping services.
        for command in ("pg_dump", "pg_restore", "psql", "runuser"):
            require(shutil.which(command), "Missing tool: " + command)
    if config["minio"]["enabled"]:
        require(Path(config["minio"]["binary"]).is_file(), "Missing MinIO server binary.")

    bundle.mkdir(parents=True, mode=0o700)
    stop_services(config)
    print("Services remain stopped on success AND failure. Do not reboot the source.", flush=True)
    if config["database"]["enabled"]:
        with open(bundle / "database.dump", "xb") as handle:
            run(pg_command(config, "pg_dump") + ["--format=custom", "--no-owner", "--no-acl"], stdout=handle)
        run(["pg_restore", "--file=/dev/null", bundle / "database.dump"])
        write_json(bundle / "row-counts.json", row_counts(config))

    for name, tree, _, _ in trees(config):
        exclusions = []
        if name == "app":
            exclusions = ["./node_modules", "./.next", "./tsconfig.tsbuildinfo", "./.agents", "./.codex", "./.aws"]
            data = Path(config["data_dir"])
            if inside(data, tree):
                exclusions.append("./" + str(data.relative_to(tree)))
        archive_directory(tree, bundle / (name + ".tar"), exclusions)
    host_paths = [path.lstrip("/") for path in config["host_config_paths"]]
    run(["tar", "--create", "--file", bundle / "host-config.tar", "--acls", "--xattrs",
         "--numeric-owner", "--directory", "/",
         *(["--", *host_paths] if host_paths else ["--files-from=/dev/null"])])
    if config["minio"]["enabled"]:
        shutil.copy2(config["minio"]["binary"], bundle / "minio-server")
    with open(bundle / "services.txt", "x", encoding="utf-8") as handle:
        for unit in units(config):
            handle.write("\n# " + unit + "\n")
            handle.write(run(["systemctl", "cat", unit], capture=True) + "\n")
    inventory = {"hostname": socket.gethostname(), "architecture": platform.machine(),
                 "os_release": Path("/etc/os-release").read_text(), "versions": {}}
    for name in ("node", "npm", "pg_dump", "pg_restore", "caddy"):
        if shutil.which(name):
            inventory["versions"][name] = run([name, "--version"] if name != "caddy" else [name, "version"], capture=True)
    if config["database"]["enabled"]:
        inventory["versions"]["postgres_server"] = sql(config, "SHOW server_version")
    if config["minio"]["enabled"]:
        inventory["versions"]["minio"] = run([config["minio"]["binary"], "--version"], capture=True)
    write_json(bundle / "inventory.json", inventory)
    write_json(bundle / "migration-config.json", config)
    write_json(bundle / "manifest.json", {
        "version": VERSION, "created_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "sha256": {path.name: digest(path) for path in sorted(bundle.iterdir()) if path.is_file()},
    })
    verify(bundle)
    print("Backup complete: " + str(bundle))
    print("Source services are still stopped. Transfer the whole directory to " + config["staging_ip"] + ".")


def restore_backup(config, bundle, stage):
    original = verify(bundle)
    require(original == config, "Use the exact reviewed configuration saved in this bundle.")
    require(platform.machine() == read_json(bundle / "inventory.json")["architecture"],
            "Architecture differs; this MinIO binary clone requires the same architecture.")
    outside_trees(bundle, config)
    outside_trees(stage, config)
    require(not inside(stage, bundle) and not inside(bundle, stage), "Keep config staging separate from the bundle.")
    empty_directory(stage)
    for _, tree, user, group in trees(config):
        empty_directory(tree)
        pwd.getpwnam(user)
        grp.getgrnam(group)
    if config["database"]["enabled"]:
        require_empty_database(config)
        owner = config["database"]["owner"].replace("'", "''")
        require(sql(config, "SELECT count(*) FROM pg_roles WHERE rolname = '" + owner + "'") == "1",
                "Create the target database owner role before restoring.")
        require(sql(config, "SHOW server_version_num").isdigit(), "Cannot read PostgreSQL server version.")
        old_version = read_json(bundle / "inventory.json")["versions"]["postgres_server"]
        require(int(sql(config, "SHOW server_version_num")) // 10000 >= int(old_version.split(".")[0]),
                "Target PostgreSQL must have the same or a newer major version.")
        run(["pg_restore", "--file=/dev/null", bundle / "database.dump"])

    stop_services(config, restoring=True)
    for name, tree, user, group in trees(config):
        # Recheck after stopping any target package-provided services.
        empty_directory(tree)
        extract(bundle / (name + ".tar"), tree)
        run(["chown", "-R", "--no-dereference", user + ":" + group, "--", tree])
    extract(bundle / "host-config.tar", stage)
    if config["minio"]["enabled"]:
        shutil.copy2(bundle / "minio-server", stage / "minio-server")
    if config["database"]["enabled"]:
        require_empty_database(config)
        # The postgres OS account cannot traverse the private backup directory.
        # Pass the archive on stdin instead of loosening backup permissions.
        with open(bundle / "database.dump", "rb") as handle:
            subprocess.run(pg_command(config, "pg_restore") + [
                "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction",
                "--role", config["database"]["owner"],
            ], stdin=handle, check=True)
        require(row_counts(config) == read_json(bundle / "row-counts.json"),
                "Restored table row counts differ. Leave target services stopped and investigate.")
        print("PostgreSQL table row counts match the backup.")
    print("Data restored. Host configuration staged at " + str(stage))
    print("No services were started. Install/review configuration, rebuild, and validate as described in the README.")
    print("No IP addresses were changed. The final address remains a separate manual step: " + config["final_ip"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("plan", "export", "verify", "restore"), nargs="?", default="plan")
    parser.add_argument("--config", type=Path, help="Reviewed private JSON configuration")
    parser.add_argument("--bundle", type=Path, help="New backup directory, or existing directory to verify/restore")
    parser.add_argument("--config-stage", type=Path, default=Path("/root/prismatica-restored-config"))
    parser.add_argument("--execute", action="store_true", help="Allow export/restore to change this host")
    parser.add_argument("--writers-stopped", action="store_true",
                        help="Acknowledge unmanaged app processes, timers, jobs and other writers are stopped")
    args = parser.parse_args()
    if len(sys.argv) == 1:
        parser.print_help()
        return
    if args.action == "verify":
        require(args.bundle is not None, "verify requires --bundle.")
        verify(args.bundle.resolve())
        return
    require(args.config is not None, "Supply --config. Start with the example JSON and README.")
    config = read_json(args.config)
    validate_config(config, executing=args.execute)
    print("Temporary target: " + config["staging_ip"] + "; final target: " + config["final_ip"])
    print("Application system services: " + (", ".join(config["app_units"]) or "NONE: stop the app manually"))
    for name, tree, _, _ in trees(config):
        print(name + ": " + str(tree))
    print("Database: " + (config["database"]["name"] if config["database"]["enabled"] else "disabled: JSON/local files only"))
    if args.action == "plan" or not args.execute:
        print("PLAN ONLY: export stops configured services and creates a private backup; restore requires empty destinations.")
        print("A restore stages host configuration for review. Nothing has been changed.")
        return
    require(os.geteuid() == 0, "Run export/restore as root.")
    require(args.writers_stopped, "Stop/disable all unmanaged writers first; then supply --writers-stopped. See README.")
    require(args.bundle is not None, "export/restore requires --bundle.")
    require_host(config, restoring=args.action == "restore")
    os.umask(0o077)
    for command in ("tar", "systemctl", "chown"):
        require(shutil.which(command), "Missing tool: " + command)
    if args.action == "export":
        export_backup(config, args.bundle.resolve())
    else:
        restore_backup(config, args.bundle.resolve(), args.config_stage.resolve())


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, TypeError, KeyboardInterrupt, subprocess.CalledProcessError) as error:
        print("ERROR: " + str(error), file=sys.stderr)
        print("No automatic restart or cleanup is attempted. A partial export has no valid completed manifest; "
              "a partial restore must be inspected before retrying. See README rollback instructions.", file=sys.stderr)
        sys.exit(1)
