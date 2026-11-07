"use client";
import { useState } from "react";
import { Brand, PrepIllustration } from "./ui";
import { teamName } from "../lib/team-types";
export default function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: () => Promise<void>;
}) {
  const [signup, setSignup] = useState(false),
    [mode, setMode] = useState<"create" | "join">("create"),
    [childName, setChildName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      const r = await fetch(signup ? "/api/signup" : "/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, mode }),
      });
      const body = await r.json();
      if (!r.ok) throw Error(body.error);
      await onAuthenticated();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not connect. Your fields are kept; please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className={"login" + (signup ? " signup" : "")}>
      <section className="login-story">
        <Brand />
        <div className="login-story-copy">
          <p className="section-kicker">Their name. Your team.</p>
          <h1>
            Less to remember.
            <br />
            <em>More shared.</em>
          </h1>
          <p>
            Team Bill. Team Maya. Name it after your child—a little reminder
            that you’re both on their side.
          </p>
          <p>A little mise en place for life between two homes.</p>
        </div>
        <PrepIllustration />
        <p className="login-story-foot">
          One team. One thoughtfully shared day.
        </p>
      </section>
      <section className="login-panel">
        <p className="section-kicker">Your place at the table</p>
        <form onSubmit={submit} key={signup ? "signup" : "login"}>
          <h2>{signup ? "Create your account" : "Sign in"}</h2>
          <p className="muted">
            {signup
              ? "One account for each parent. One shared team."
              : "The details of family life, all in one place."}
          </p>
          {signup && (
            <label>
              Your name
              <input name="name" autoComplete="name" maxLength={80} required />
            </label>
          )}
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              maxLength={254}
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
              minLength={signup ? 12 : undefined}
              maxLength={200}
              required
            />
          </label>
          {signup && (
            <>
              <p className="muted">
                Use at least 12 characters for your password.
              </p>
              <fieldset className="team-choice">
                <legend>Your team</legend>
                <label className="check-label">
                  <input
                    type="radio"
                    name="teamMode"
                    value="create"
                    checked={mode === "create"}
                    onChange={() => {
                      setMode("create");
                      setError("");
                    }}
                  />
                  Create a team
                </label>
                <label className="check-label">
                  <input
                    type="radio"
                    name="teamMode"
                    value="join"
                    checked={mode === "join"}
                    onChange={() => {
                      setMode("join");
                      setError("");
                    }}
                  />
                  Join the other parent’s team
                </label>
              </fieldset>
              {mode === "create" ? (
                <>
                  <label key="child-name">
                    Child&apos;s name or nickname
                    <input
                      name="childName"
                      value={childName}
                      onChange={(e) => setChildName(e.target.value)}
                      maxLength={40}
                      autoComplete="off"
                      required
                      aria-describedby="signup-team-help"
                    />
                  </label>
                  <p className="muted" id="signup-team-help">
                    We’ll call it{" "}
                    <strong>
                      {teamName(childName.trim() || "[child’s name]")}
                    </strong>
                    . Both parents can change this later.
                  </p>
                </>
              ) : (
                <>
                  <label key="invitation-code">
                    Invitation code
                    <input
                      name="invite"
                      maxLength={24}
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      required
                      aria-describedby="invite-help"
                    />
                  </label>
                  <p className="muted" id="invite-help">
                    Ask the other parent to open More → Your team and create a
                    private invitation. Joining puts you in the same household.
                  </p>
                </>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button disabled={busy}>
            {busy
              ? signup
                ? "Creating account…"
                : "Signing in…"
              : signup
                ? "Create account"
                : "Sign in"}
          </button>
        </form>
        <button
          className="text auth-switch"
          disabled={busy}
          onClick={() => {
            setSignup(!signup);
            setError("");
          }}
        >
          {signup ? "Already have an account? Sign in" : "Create an account"}
        </button>
        <p className="login-privacy">
          <span aria-hidden="true">·</span>A private space for your household.
        </p>
      </section>
    </main>
  );
}
