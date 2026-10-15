import { ConnectedUsersPanel } from "@/components/connected-users-panel";
import { useMemo, useState } from "react";
import { AlertTriangle, Check, UserPlus, Users } from "lucide-react";
import type { AppUser } from "@/lib/prismaData";
import { SectionTitle } from "@/components/prisma-review-ui";

type FormSubmitEvent = {
  preventDefault: () => void;
};

type AdminCreateUserForm = {
  name: string;
  email: string;
  organization: string;
  title: string;
};

type RegisteredUsersSectionProps = {
  users: AppUser[];
  currentUser: AppUser;
  adminDirectoryMessage: string;
  createUserMessage: string;
  adminResetUserPassword: (user: AppUser) => void;
  adminDeleteUser: (user: AppUser) => void;
  createUserForm: AdminCreateUserForm;
  onCreateUserFormNameChange: (value: string) => void;
  onCreateUserFormEmailChange: (value: string) => void;
  onCreateUserFormOrganizationChange: (value: string) => void;
  onCreateUserFormTitleChange: (value: string) => void;
  onCreateUser: (event: FormSubmitEvent) => void;
  isCreatingUser: boolean;
  pendingUserAction: { userId: string; action: "reset" | "delete" } | null;
};

const adminUsersPageSize = 10;

export function RegisteredUsersSection({
  users,
  currentUser,
  adminDirectoryMessage,
  createUserMessage,
  adminResetUserPassword,
  adminDeleteUser,
  createUserForm,
  onCreateUserFormNameChange,
  onCreateUserFormEmailChange,
  onCreateUserFormOrganizationChange,
  onCreateUserFormTitleChange,
  onCreateUser,
  isCreatingUser,
  pendingUserAction
}: RegisteredUsersSectionProps) {
  const adminDirectoryMessageIsSuccess = /^(Temporary password|Deleted account|Created account|User account created)/i.test(adminDirectoryMessage);
  const createUserMessageIsSuccess = /^(Created account|User account created)/i.test(createUserMessage);
  const userPageCount = Math.max(1, Math.ceil(users.length / adminUsersPageSize));
  const [userPage, setUserPage] = useState(1);
  const currentUserPage = Math.min(userPage, userPageCount);
  const userPageStart = (currentUserPage - 1) * adminUsersPageSize;
  const pagedUsers = useMemo(() => users.slice(userPageStart, userPageStart + adminUsersPageSize), [userPageStart, users]);
  const firstUserNumber = users.length === 0 ? 0 : userPageStart + 1;
  const lastUserNumber = Math.min(userPageStart + pagedUsers.length, users.length);

  return (
    <div className="viewStack">
      <section className="overviewBand">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Registered Users</h1>
          <p className="subtle">Monitor connected users, create reviewer accounts, reset access, and remove spam accounts.</p>
        </div>
      </section>

      <ConnectedUsersPanel currentUserId={currentUser.id} />

      <section className="settingsGrid">
        <div className="panel">
          <SectionTitle icon={Users} title="User Accounts" action={`${users.length} registered`} />
          <div className="memberPicker">
            {pagedUsers.map((user) => {
              const isResettingUser = pendingUserAction?.userId === user.id && pendingUserAction.action === "reset";
              const isDeletingUser = pendingUserAction?.userId === user.id && pendingUserAction.action === "delete";
              const disableUserActions = user.id === currentUser.id || user.isAdmin || pendingUserAction !== null;

              return (
                <div className={`${user.id === currentUser.id ? "userSwitch active" : "userSwitch"} adminManagedUserSwitch`} key={user.id}>
                  <span className="avatar" style={{ background: user.avatarColor }}>
                    {user.initials}
                  </span>
                  <div>
                    <strong>{user.name}</strong>
                    <small>
                      {user.email} · {user.title}
                      {user.isAdmin ? " · administrator" : ""}
                    </small>
                  </div>
                  <div className="userSwitchActions">
                    <button
                      className="ghostButton"
                      type="button"
                      disabled={disableUserActions}
                      onClick={() => adminResetUserPassword(user)}
                    >
                      {isResettingUser ? <span className="inlineSpinner" aria-hidden="true" /> : null}
                      {isResettingUser ? "Resetting..." : "Reset password"}
                    </button>
                    <button
                      className="dangerButton"
                      type="button"
                      disabled={disableUserActions}
                      onClick={() => adminDeleteUser(user)}
                    >
                      {isDeletingUser ? <span className="inlineSpinner" aria-hidden="true" /> : null}
                      {isDeletingUser ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {userPageCount > 1 ? (
            <div className="paginationBar" aria-label="User directory pagination">
              <button className="ghostButton" type="button" disabled={currentUserPage <= 1} onClick={() => setUserPage(Math.max(currentUserPage - 1, 1))}>
                Previous
              </button>
              <span>{`Showing ${firstUserNumber}-${lastUserNumber} of ${users.length}`}</span>
              <button className="ghostButton" type="button" disabled={currentUserPage >= userPageCount} onClick={() => setUserPage(Math.min(currentUserPage + 1, userPageCount))}>
                Next
              </button>
            </div>
          ) : null}
          {adminDirectoryMessage ? (
            <div className={adminDirectoryMessageIsSuccess ? "validationItem ok adminDirectoryFeedback" : "validationItem blocked adminDirectoryFeedback"}>
              {adminDirectoryMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
              <span>{adminDirectoryMessage}</span>
            </div>
          ) : null}
        </div>

        <div className="panel">
          <SectionTitle icon={UserPlus} title="Create User" action="Admin only" />
          <p className="subtle">Create a reviewer account directly. A temporary password will be generated and shown after creation.</p>
          <form className="inviteForm" onSubmit={onCreateUser}>
            <label>
              <span>Name</span>
              <input value={createUserForm.name} onChange={(event) => onCreateUserFormNameChange(event.target.value)} />
            </label>
            <label>
              <span>Email</span>
              <input value={createUserForm.email} onChange={(event) => onCreateUserFormEmailChange(event.target.value)} />
            </label>
            <label>
              <span>Organization</span>
              <input value={createUserForm.organization} onChange={(event) => onCreateUserFormOrganizationChange(event.target.value)} />
            </label>
            <label>
              <span>Role title</span>
              <input value={createUserForm.title} onChange={(event) => onCreateUserFormTitleChange(event.target.value)} />
            </label>
            <button className="ghostButton" type="submit" disabled={isCreatingUser}>
              {isCreatingUser ? (
                <>
                  <span className="inlineSpinner" aria-hidden="true" />
                  Creating...
                </>
              ) : (
                <>
                  <UserPlus size={17} />
                  Create user
                </>
              )}
            </button>
            {createUserMessage ? (
              <div
                className={createUserMessageIsSuccess ? "validationItem ok adminDirectoryFeedback" : "validationItem blocked adminDirectoryFeedback"}
                role="status"
              >
                {createUserMessageIsSuccess ? <Check size={17} /> : <AlertTriangle size={17} />}
                <span>{createUserMessage}</span>
              </div>
            ) : null}
          </form>
        </div>


      </section>
    </div>
  );
}
