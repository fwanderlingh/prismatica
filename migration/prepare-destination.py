#!/usr/bin/env python3
"""Prepare an Ubuntu migration destination. Defaults to a read-only plan.

Read migration/README.md. Installation requires root, the reviewed private
migration configuration and --execute. This script does not restore app data.
"""

import argparse
from contextlib import contextmanager
import datetime
import fcntl
import grp
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import platform
import pwd
import re
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tempfile


MARKER = "# Managed by Prismatica prepare-destination.py\n"
DEFAULT_NODE_MAJOR = 24
DEFAULT_POSTGRES_MAJOR = 18
BASE_PACKAGES = [
    "ca-certificates", "curl", "gnupg", "apt-transport-https",
    "debian-keyring", "debian-archive-keyring", "openssh-server",
    "python3", "python3-venv", "git", "rsync", "tmux", "tar",
    "acl", "attr", "iproute2", "util-linux", "xz-utils",
    "build-essential", "pkg-config", "libpq-dev", "libatomic1",
]
BROAD_PATHS = {"/", "/home", "/root", "/etc", "/usr", "/usr/local",
               "/var", "/var/lib", "/var/www", "/srv", "/opt", "/tmp", "/mnt", "/media"}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(argv, capture=False, env=None):
    result = subprocess.run([str(part) for part in argv], check=True,
                            stdout=subprocess.PIPE if capture else None,
                            text=capture, env=dict(os.environ, LC_ALL="C") if env is None else env)
    return result.stdout.strip() if capture else None


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def os_release():
    result = {}
    for line in Path("/etc/os-release").read_text().splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            parts = shlex.split(value)
            result[key] = parts[0] if parts else ""
    return result


def checked_path(value):
    path = Path(value)
    require(path.is_absolute() and str(path) not in BROAD_PATHS,
            "Use a specific absolute directory path.")
    require(".." not in path.parts and not any(ord(char) < 32 for char in value),
            "Invalid directory path.")
    require(path.resolve() == path, "Use physical, normalized directory paths without symlinks.")
    return path


def inside(path, parent):
    return path == parent or parent in path.parents


def storage_trees(config):
    result = [("app", checked_path(config["app_dir"]), config["app_user"], config["app_group"]),
              ("data", checked_path(config["data_dir"]), config["app_user"], config["app_group"])]
    for name in ("minio", "caddy"):
        section = config[name]
        if section["enabled"]:
            result.append((name, checked_path(section["data_dir"]), section["user"], section["group"]))
    return result


def validate(config):
    require(config["version"] == 1, "Unsupported migration configuration version.")
    require(config["source_hostname"] != config["target_hostname"], "Source and target hostnames must differ.")
    ipaddress.IPv4Address(config["staging_ip"])
    for name in ("minio", "caddy", "database"):
        require(isinstance(config[name]["enabled"], bool), name + ".enabled must be a boolean.")
    trees = storage_trees(config)
    app, data = trees[:2]
    require(not inside(app[1], data[1]), "data_dir cannot contain app_dir.")
    for index, (_, path, user, group) in enumerate(trees):
        for account in (user, group):
            require(re.fullmatch(r"[a-z_][a-z0-9_-]*[$]?", account) and account != "root",
                    "Use non-root Linux application/service accounts.")
        for other_index, (_, other, _, _) in enumerate(trees[:index]):
            if index == 1 and other_index == 0:
                continue
            require(not inside(path, other) and not inside(other, path), "Storage trees overlap.")
    if config["database"]["enabled"]:
        db = config["database"]
        require(db["os_user"] == "postgres", "Ubuntu preparation expects the postgres OS administrator account.")
        # /var/run is a normal Ubuntu symlink to /run; socket paths may use it.
        require(Path(db["socket_dir"]).is_absolute() and ".." not in Path(db["socket_dir"]).parts
                and not any(ord(char) < 32 for char in db["socket_dir"]), "Invalid PostgreSQL socket directory.")
        require(isinstance(db["port"], int) and 1024 <= db["port"] <= 65535, "Invalid PostgreSQL port.")
    for unit in config["app_units"] + [config[name]["unit"] for name in ("minio", "caddy") if config[name]["enabled"]]:
        require(re.fullmatch(r"[A-Za-z0-9_@.:-]+\.service", unit), "Invalid system service name.")


def version_major(value):
    match = re.search(r"(?:^|\s)v?(\d+)\.", value)
    require(match is not None, "Cannot determine major version from inventory.")
    return int(match.group(1))


def select_versions(args):
    versions = {}
    if args.bundle:
        # Read only the small version inventory; restore verifies every artifact later.
        manifest = read_json(args.bundle / "manifest.json")
        require(manifest["version"] == 1, "Unsupported backup manifest version.")
        inventory_path = args.bundle / "inventory.json"
        require(not inventory_path.is_symlink(), "Inventory must not be a symlink.")
        require(hashlib.sha256(inventory_path.read_bytes()).hexdigest() == manifest["sha256"]["inventory.json"],
                "Inventory checksum mismatch.")
        inventory = read_json(inventory_path)
        require(inventory["architecture"] == platform.machine(), "Source and target architectures differ.")
        versions = inventory["versions"]
    node = args.node_major if args.node_major is not None else (version_major(versions["node"]) if "node" in versions else DEFAULT_NODE_MAJOR)
    pg_minimum = max([version_major(versions[key]) for key in ("postgres_server", "pg_dump") if key in versions] or [0])
    postgres = args.postgres_major if args.postgres_major is not None else max(DEFAULT_POSTGRES_MAJOR, pg_minimum)
    require(node >= 22 and node % 2 == 0, "Select an even Node.js major version >= 22 supported by NodeSource.")
    require(postgres >= 14 and postgres >= pg_minimum,
            "PostgreSQL must be at least as new as the source server and pg_dump major versions.")
    return node, postgres


def empty_directory(path):
    require(not path.is_symlink(), "Refusing a symlink storage directory.")
    require(not path.exists() or (path.is_dir() and not any(path.iterdir())),
            "Storage destination is not empty; move it aside intentionally before preparation: " + str(path))


def preflight(config, release):
    require(os.geteuid() == 0, "Use sudo for --execute.")
    require("REPLACE_" not in json.dumps(config), "Fill all migration configuration placeholders first.")
    require(socket.gethostname() == config["target_hostname"], "This is not the configured target hostname.")
    require(release.get("ID") == "ubuntu" and int(release["VERSION_ID"].split(".")[0]) >= 22,
            "This installer supports Ubuntu 22.04 or newer with systemd.")
    require(re.fullmatch(r"[a-z]+", release.get("VERSION_CODENAME", "")), "Missing Ubuntu release codename.")
    require(Path("/run/systemd/system").is_dir(), "A running systemd system is required.")
    require(shutil.which("ip"), "Install iproute2 first; the destination IP must be checked before installation.")
    addresses = json.loads(run(["ip", "-j", "-4", "address", "show"], capture=True))
    require(any(info.get("local") == config["staging_ip"]
                for interface in addresses for info in interface.get("addr_info", [])),
            "The configured staging IP is not assigned to this PC.")
    architecture = run(["dpkg", "--print-architecture"], capture=True)
    require(architecture in ("amd64", "arm64"), "Only amd64 and arm64 are supported.")
    for _, path, _, _ in storage_trees(config):
        empty_directory(path)
    units = config["app_units"] + [config[name]["unit"] for name in ("minio", "caddy") if config[name]["enabled"]]
    if config["caddy"]["enabled"]:
        units.append("caddy.service")
    for unit in dict.fromkeys(units):
        state = subprocess.run(["systemctl", "is-active", "--quiet", unit], check=False)
        require(state.returncode in (0, 3, 4), "Cannot inspect service: " + unit)
        require(state.returncode != 0, "Stop the existing destination service before preparation: " + unit)
    return architecture


@contextmanager
def prevent_package_service_starts():
    # Preserve any existing site policy exactly, including a symlink.
    policy = Path("/usr/sbin/policy-rc.d")
    saved = policy.with_name("policy-rc.d.prismatica-" + str(os.getpid()) + ".saved")
    require(not saved.exists() and not saved.is_symlink(), "Temporary service-policy backup already exists.")
    had_policy = policy.exists() or policy.is_symlink()
    if policy.is_file() and not policy.is_symlink():
        require(MARKER not in policy.read_text(errors="replace"),
                "An interrupted preparation left its temporary service policy installed. "
                "Inspect /usr/sbin/policy-rc.d.prismatica-*.saved and restore the previous policy before retrying.")
    if had_policy:
        policy.rename(saved)
    try:
        with open(policy, "x", encoding="utf-8") as handle:
            handle.write("#!/bin/sh\n" + MARKER + "exit 101\n")
        policy.chmod(0o755)
        yield
    finally:
        if policy.exists() or policy.is_symlink():
            policy.unlink()
        if had_policy:
            saved.rename(policy)


def apt(*arguments):
    env = dict(os.environ, LC_ALL="C", DEBIAN_FRONTEND="noninteractive", NEEDRESTART_MODE="l")
    run(["apt-get", "-o", "Dpkg::Options::=--force-confold", *arguments], env=env)


def managed_text(path, value):
    path = Path(path)
    require(not path.is_symlink(), "Refusing a symlink at a managed repository path.")
    require(not path.exists() or path.read_text().startswith(MARKER),
            "An unmanaged file already exists: " + str(path))
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False, encoding="utf-8") as handle:
        temporary = Path(handle.name)
        handle.write(MARKER + value)
    temporary.chmod(0o644)
    temporary.replace(path)


def download(url, output):
    run(["curl", "--proto", "=https", "--proto-redir", "=https", "--tlsv1.2", "--fail", "--silent", "--show-error",
         "--location", "--retry", "3", "--connect-timeout", "15", "--max-time", "120",
         "--output", output, url])


def repository_key(url, name, directory):
    source = directory / (name + ".asc")
    binary = directory / (name + ".gpg")
    download(url, source)
    run(["gpg", "--batch", "--yes", "--no-options", "--homedir", directory,
         "--dearmor", "--output", binary, source])
    target = Path("/usr/share/keyrings") / ("prismatica-" + name + ".gpg")
    require(not target.is_symlink(), "Refusing a symlink repository key.")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(binary, target)
    target.chmod(0o644)
    return str(target)


def configure_repositories(config, node, architecture, codename):
    with tempfile.TemporaryDirectory(prefix="prismatica-repositories-") as temporary:
        directory = Path(temporary)
        key = repository_key("https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key", "nodesource", directory)
        managed_text("/etc/apt/sources.list.d/prismatica-nodesource.sources",
                     "Types: deb\nURIs: https://deb.nodesource.com/node_" + str(node) + ".x\n"
                     "Suites: nodistro\nComponents: main\nArchitectures: " + architecture + "\nSigned-By: " + key + "\n")
        managed_text("/etc/apt/preferences.d/prismatica-nodejs",
                     "Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n")
        if config["database"]["enabled"]:
            key = repository_key("https://www.postgresql.org/media/keys/ACCC4CF8.asc", "pgdg", directory)
            managed_text("/etc/apt/sources.list.d/prismatica-pgdg.sources",
                         "Types: deb\nURIs: https://apt.postgresql.org/pub/repos/apt\nSuites: " + codename + "-pgdg\n"
                         "Components: main\nArchitectures: " + architecture + "\nSigned-By: " + key + "\n")
        if config["caddy"]["enabled"]:
            key = repository_key("https://dl.cloudsmith.io/public/caddy/stable/gpg.key", "caddy", directory)
            listing = directory / "caddy.list"
            download("https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt", listing)
            text = listing.read_text().replace("/usr/share/keyrings/caddy-stable-archive-keyring.gpg", key)
            require("https://dl.cloudsmith.io/public/caddy/stable/deb/debian" in text and "signed-by=" + key in text,
                    "Caddy repository format changed; review the current official installation instructions.")
            managed_text("/etc/apt/sources.list.d/prismatica-caddy.list", text)


def ensure_account(user, group, system=False, home=None):
    try:
        grp.getgrnam(group)
    except KeyError:
        run(["groupadd", *(["--system"] if system else []), "--", group])
    try:
        pwd.getpwnam(user)
    except KeyError:
        run(["useradd", *(["--system"] if system else []), "--create-home", "--home-dir", home or "/home/" + user,
             "--shell", "/usr/sbin/nologin" if system else "/bin/bash", "--gid", group, "--", user])
        print("Created account " + user + " with no login password. Configure SSH access separately if needed.")


def owned_directory(path, user, group):
    uid, gid = pwd.getpwnam(user).pw_uid, grp.getgrnam(group).gr_gid
    missing = []
    current = path
    while not current.exists():
        missing.append(current)
        current = current.parent
    for directory in reversed(missing):
        directory.mkdir(mode=0o750)
        os.chown(directory, uid, gid)
    os.chown(path, uid, gid)


def prepare_accounts_and_storage(config):
    ensure_account(config["app_user"], config["app_group"])
    for name in ("minio", "caddy"):
        section = config[name]
        if section["enabled"]:
            ensure_account(section["user"], section["group"], system=True,
                           home=section["data_dir"] if name == "caddy" else None)
    app = Path(config["app_dir"])
    for name, path, user, group in storage_trees(config):
        # Creating a nested data directory now would make app_dir nonempty and
        # violate migrate-server.py's empty-destination requirement.
        if name == "data" and inside(path, app):
            continue
        if name == "caddy" and path.exists() and any(path.iterdir()):
            # Preflight established this tree was empty before package installation.
            # Preserve only the initial files just generated by package/user setup.
            destination = Path("/root/prismatica-preparation-state") / datetime.datetime.now().strftime("%Y%m%dT%H%M%S-%f")
            destination.mkdir(parents=True, mode=0o700)
            for child in list(path.iterdir()):
                shutil.move(str(child), str(destination / child.name))
            print("Initial Caddy package state preserved at " + str(destination))
        empty_directory(path)
        owned_directory(path, user, group)


def clusters():
    if not shutil.which("pg_lsclusters"):
        return []
    result = []
    for line in run(["pg_lsclusters", "--no-header"], capture=True).splitlines():
        parts = re.sub(r"\x1b\[[0-9;]*m", "", line).split()
        if parts:
            result.append({"version": parts[0], "name": parts[1], "port": int(parts[2]), "status": parts[3]})
    return result


def start_postgres(config, postgres, previous_clusters):
    db = config["database"]
    current = clusters()
    selected = [row for row in current if row["version"] == str(postgres) and row["name"] == "main"]
    require(not any(row["port"] == db["port"] and row not in selected for row in current),
            "Another PostgreSQL cluster uses the configured port; no existing cluster was changed.")
    if not selected:
        run(["pg_createcluster", str(postgres), "main", "--port", str(db["port"]),
             "--socketdir", db["socket_dir"], "--", "--encoding=UTF8"])
    else:
        row = selected[0]
        existed = any(old["version"] == str(postgres) and old["name"] == "main" for old in previous_clusters)
        if not existed:
            run(["pg_conftool", str(postgres), "main", "set", "port", str(db["port"])])
            run(["pg_conftool", str(postgres), "main", "set", "unix_socket_directories", db["socket_dir"]])
        else:
            require(row["port"] == db["port"], "Existing PostgreSQL cluster port differs from the migration configuration.")
    row = next(row for row in clusters() if row["version"] == str(postgres) and row["name"] == "main")
    if row["status"] != "online":
        run(["pg_ctlcluster", str(postgres), "main", "start"])
    run(["systemctl", "enable", "postgresql.service"])
    run(["runuser", "-u", "postgres", "--", "psql", "--host", db["socket_dir"], "--port", str(db["port"]),
         "--dbname", "postgres", "--no-password", "-X", "-v", "ON_ERROR_STOP=1", "-c", "SELECT 1;"])


def install_packages(config, node, postgres, release, architecture):
    previous_clusters = clusters()
    print("Installing Ubuntu prerequisites and signed APT repositories.", flush=True)
    with prevent_package_service_starts():
        apt("update")
        apt("install", "--yes", "--no-remove", "--no-install-recommends", *BASE_PACKAGES)
        configure_repositories(config, node, architecture, release["VERSION_CODENAME"])
        apt("update")
        candidate = run(["apt-cache", "policy", "nodejs"], capture=True)
        match = re.search(r"Candidate:\s+(?:\d+:)?(\d+)\.", candidate)
        require(match and int(match[1]) == node, "APT's Node.js candidate does not match the selected major version.")
        packages = ["nodejs"]
        if config["database"]["enabled"]:
            packages += ["postgresql-" + str(postgres), "postgresql-client-" + str(postgres)]
        if config["caddy"]["enabled"]:
            packages.append("caddy")
        apt("install", "--yes", "--no-remove", "--no-install-recommends", *packages)
    if config["caddy"]["enabled"]:
        # The package supplies caddy.service; a custom source unit is installed
        # later from the backup, so it need not exist on the fresh destination.
        run(["systemctl", "stop", "caddy.service"])
        run(["systemctl", "disable", "caddy.service"])
    prepare_accounts_and_storage(config)
    if config["database"]["enabled"]:
        start_postgres(config, postgres, previous_clusters)
    run(["systemctl", "enable", "--now", "ssh.service"])
    require(version_major(run(["node", "--version"], capture=True)) == node, "Unexpected Node.js version on PATH.")
    for program in ("node", "npm", "pg_dump", "pg_restore"):
        if shutil.which(program):
            print(program + ": " + run([program, "--version"], capture=True))
    if config["caddy"]["enabled"]:
        print("caddy: " + run(["caddy", "version"], capture=True))
    print("Preparation complete. SSH is available; configured PostgreSQL is started and Caddy remains stopped.")
    print("Next: create the database role/empty database, then follow README.md for transfer and restore.")
    print("MinIO's existing binary/unit come from the backup. No app data, secrets or IP settings were installed.")


def install(config, node, postgres, release):
    architecture = preflight(config, release)
    # Serialize our temporary global service-start policy across concurrent runs.
    with open("/run/lock/prismatica-destination-preparation.lock", "a", encoding="utf-8") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("Another destination preparation is already running.")
        install_packages(config, node, postgres, release, architecture)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True, help="Filled private migration JSON")
    parser.add_argument("--node-major", type=int, help="Node.js major; default 24, or the source inventory major")
    parser.add_argument("--postgres-major", type=int, help="PostgreSQL major; default 18 or newer if the source requires it")
    parser.add_argument("--bundle", type=Path, help="Optional completed source backup for version/architecture checks")
    parser.add_argument("--execute", action="store_true", help="Install packages and prepare the destination; otherwise print a plan")
    args = parser.parse_args()
    config = read_json(args.config)
    validate(config)
    node, postgres = select_versions(args)
    release = os_release()
    print("Destination preparation plan for " + config["target_hostname"])
    print("Node.js " + str(node) + " with bundled npm (NodeSource APT repository).")
    print("PostgreSQL " + str(postgres) + " server/client (PGDG APT repository)." if config["database"]["enabled"] else "PostgreSQL disabled in config.")
    print("Caddy stable (official APT repository)." if config["caddy"]["enabled"] else "Caddy disabled in config.")
    print("Supporting packages: " + ", ".join(BASE_PACKAGES))
    print("Create missing named accounts and empty storage roots; enable SSH and the selected PostgreSQL cluster.")
    print("Keep Caddy stopped. MinIO binary/configuration will be restored from the source backup.")
    if not args.execute:
        print("PLAN ONLY. No packages, users, files, services or repositories have been changed.")
        return
    # Ensure ordinary termination restores the temporary package-start policy.
    def interrupted(signum, frame):
        raise KeyboardInterrupt("Preparation interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    install(config, node, postgres, release)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, TypeError, KeyboardInterrupt, subprocess.CalledProcessError) as error:
        print("ERROR: " + str(error), file=sys.stderr)
        print("Preparation did not complete. Installed packages are retained; inspect the error before retrying. "
              "No migration or application startup is attempted.", file=sys.stderr)
        sys.exit(1)
