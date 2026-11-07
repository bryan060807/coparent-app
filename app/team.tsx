"use client";
import { useState } from "react";
import { teamName, type Team } from "../lib/team-types";
const key = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export default function TeamSettings({
  team,
  members,
  onSaved,
}: {
  team: Team;
  members: { id: string; name: string }[];
  onSaved: (team: Team) => void;
}) {
  const [draft, setDraft] = useState(team.childName),
    [version, setVersion] = useState(team.version),
    [requestKey, setRequestKey] = useState(key),
    [busy, setBusy] = useState<"save" | "invite" | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [invitation, setInvitation] = useState<{
      code: string;
      expires: number;
    } | null>(null);
  const stale = team.version !== version;
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || stale) return;
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childName: draft, version, key: requestKey }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      onSaved(result);
      setDraft(result.childName);
      setVersion(result.version);
      setRequestKey(key());
      setNotice("Team name saved. Both parents will see it.");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not save. Your draft is kept; try again.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function invite() {
    if (busy) return;
    setBusy("invite");
    setError("");
    setNotice("");
    setInvitation(null);
    try {
      const r = await fetch("/api/team/invitations", { method: "POST" });
      const result = await r.json();
      if (!r.ok) throw Error(result.error);
      setInvitation(result);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not create an invitation. Try again.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="team-settings">
      <p className="section-kicker">Their name. Your team.</p>
      <h1>Your team</h1>
      <p className="intro">
        Put your child’s name at the heart of the app. Across two homes, you’re
        on the same team.
      </p>
      <form onSubmit={save}>
        <div className="team-preview">
          <small>Your team name</small>
          <output htmlFor="team-child-name">
            {teamName(draft.trim() || "[child’s name]")}
          </output>
        </div>
        <label htmlFor="team-child-name">Child&apos;s name or nickname</label>
        <input
          id="team-child-name"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setNotice("");
          }}
          maxLength={40}
          required
          aria-describedby="team-name-help"
          autoComplete="off"
        />
        <p id="team-name-help" className="muted">
          Use just the name; we’ll add “Team”. Both parents can edit this for
          your household.
        </p>
        {stale && (
          <div className="note" role="status">
            <strong>The team name changed while you were editing.</strong>
            <p>It’s now {team.name}. Your draft is kept.</p>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setDraft(team.childName);
                setVersion(team.version);
                setRequestKey(key());
                setError("");
                setNotice("");
              }}
            >
              Load current name and replace my draft
            </button>
          </div>
        )}
        <button disabled={!!busy || stale}>
          {busy === "save" ? "Saving…" : "Save team name"}
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {team.updatedBy && team.updatedAt && (
        <p className="muted">
          Last named by {team.updatedBy} ·{" "}
          {new Date(team.updatedAt).toLocaleString()}
        </p>
      )}
      <section>
        <h2>Parents on this team</h2>
        <ul className="team-members">
          {members.map((member) => (
            <li key={member.id}>{member.name}</li>
          ))}
        </ul>
        {members.length < 2 ? (
          <>
            <h2>Invite the other parent</h2>
            <p>
              Share a private code so the other parent can create their own
              account and join this household.
            </p>
            {invitation && (
              <div className="note" role="status">
                <label htmlFor="team-invite-code">Invitation code</label>
                <input
                  id="team-invite-code"
                  readOnly
                  value={invitation.code}
                  onFocus={(e) => e.currentTarget.select()}
                  spellCheck={false}
                />
                <p className="muted">
                  Valid once, until{" "}
                  {new Date(invitation.expires).toLocaleString()}. Share it
                  privately with the other parent.
                </p>
                <p>
                  They choose{" "}
                  <strong>
                    Create an account → Join the other parent’s team
                  </strong>
                  , then paste this code.
                </p>
              </div>
            )}
            <button className="secondary" disabled={!!busy} onClick={invite}>
              {busy === "invite"
                ? "Creating invitation…"
                : invitation
                  ? "Create a new invitation"
                  : "Create invitation"}
            </button>
            <p className="muted">
              A new invitation replaces any unused code. Invitations expire
              after 72 hours.
            </p>
          </>
        ) : (
          <p className="muted">
            Both parent places are filled. You each sign in with your own email
            and password.
          </p>
        )}
      </section>
    </div>
  );
}
