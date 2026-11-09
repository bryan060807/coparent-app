"use client";
import { useEffect, useRef, useState } from "react";
import {
  themes,
  fonts,
  backgrounds,
  normalizedAppearance,
} from "../lib/appearance";
import {
  defaultAppearance,
  type Appearance,
  type HubView,
} from "../lib/hub-types";
export default function AppSettings({
  data,
  save,
  childOnly = false,
}: {
  data: HubView;
  save: (body: Record<string, unknown>) => Promise<HubView>;
  childOnly?: boolean;
}) {
  const [tab, setTab] = useState<"mine" | "child">("mine");
  return (
    <section className="app-settings">
      <p className="section-kicker">Make yourself at home</p>
      <h1>App settings</h1>
      <p>
        Choose how Team looks and behaves. Your profile details live on My
        profile.
      </p>
      {data.role === "parent" && !childOnly && (
        <nav className="settings-tabs" aria-label="Settings scope">
          <button
            className={tab === "mine" ? "active" : "secondary"}
            onClick={() => setTab("mine")}
          >
            My app settings
          </button>
          <button
            className={tab === "child" ? "active" : "secondary"}
            onClick={() => setTab("child")}
          >
            Child defaults
          </button>
        </nav>
      )}
      <SettingsForm
        key={tab}
        data={data}
        childDefault={tab === "child"}
        save={save}
      />
    </section>
  );
}
function SettingsForm({
  data,
  childDefault,
  save,
}: {
  data: HubView;
  childDefault: boolean;
  save: (b: Record<string, unknown>) => Promise<HubView>;
}) {
  const saved = childDefault
    ? data.childSettings?.appearance
    : data.profile.appearance;
  const currentVersion = childDefault
    ? (data.childSettings?.version ?? 0)
    : (data.profile.settingsVersion ?? 0);
  const [draft, setDraft] = useState(normalizedAppearance(saved)),
    [inherit, setInherit] = useState(!!data.profile.inheritChildAppearance),
    [allowLocation, setAllowLocation] = useState(
      data.childSettings?.locationAllowed ?? false,
    ),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const baseline = useRef(currentVersion),
    key = useRef(crypto.randomUUID());
  const isChild = childDefault || data.role === "child";
  const photos = data.photos.filter((p) => !childDefault || p.childVisible);
  function load() {
    setDraft(normalizedAppearance(saved));
    setInherit(!!data.profile.inheritChildAppearance);
    setAllowLocation(data.childSettings?.locationAllowed ?? false);
    baseline.current = currentVersion;
    key.current = crypto.randomUUID();
    setDirty(false);
    setError("");
  }
  const incoming = JSON.stringify(saved);
  useEffect(() => {
    if (!dirty) load();
  }, [currentVersion, incoming]);
  function change<K extends keyof Appearance>(name: K, value: Appearance[K]) {
    setDraft((p) => ({
      ...p,
      [name]: value,
      ...(name === "textSize"
        ? { largeText: value === "large" || value === "extra" }
        : {}),
    }));
    setDirty(true);
    setNotice("");
    key.current = crypto.randomUUID();
  }
  const bool = (
    name: "reduceMotion" | "highContrast" | "dashboardSummaries",
    label: string,
  ) => (
    <label className="check-label">
      <input
        type="checkbox"
        checked={draft[name]}
        onChange={(e) => change(name, e.target.checked)}
      />
      {label}
    </label>
  );
  return (
    <form
      className="settings-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          const body = {
            op: childDefault ? "childSettings" : "settings",
            version: baseline.current,
            key: key.current,
            appearance: draft,
            inheritChildAppearance: inherit,
            locationAllowed: allowLocation,
          };
          const next = await save(body);
          baseline.current = childDefault
            ? next.childSettings!.version
            : (next.profile.settingsVersion ?? 0);
          setDirty(false);
          key.current = crypto.randomUUID();
          setNotice(
            childDefault ? "Child defaults saved." : "App settings saved.",
          );
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {childDefault && (
        <div className="note">
          <h2>Your child's starting look</h2>
          <p>
            These defaults apply to a new child account and whenever your child
            selects “Use my team's defaults.” Existing personal choices stay
            personal.
          </p>
        </div>
      )}
      {data.role === "child" && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={inherit}
            onChange={(e) => {
              setInherit(e.target.checked);
              setDirty(true);
              key.current = crypto.randomUUID();
            }}
          />
          Use my team's defaults
        </label>
      )}
      <fieldset disabled={busy || (data.role === "child" && inherit)}>
        <legend>Appearance</legend>
        <h2>Color theme</h2>
        <div className="theme-picker">
          {themes.map((t) => (
            <label
              className={draft.theme === t.id ? "chosen" : ""}
              key={t.id}
              style={{ "--swatch": t.color } as React.CSSProperties}
            >
              <input
                type="radio"
                name="color-theme"
                value={t.id}
                checked={draft.theme === t.id}
                onChange={() => change("theme", t.id)}
              />
              <span className="theme-dot" aria-hidden="true" />
              {t.name}
            </label>
          ))}
        </div>
        <label>
          Font
          <select
            aria-label="Font"
            value={draft.font}
            onChange={(e) =>
              change("font", e.target.value as Appearance["font"])
            }
          >
            {fonts.map((f) => (
              <option value={f.id} key={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div
          className="settings-preview"
          data-preview={draft.font}
          data-card-style={draft.cardStyle}
          style={{
            borderColor: themes.find((t) => t.id === draft.theme)?.color,
            fontSize: { small: 15, standard: 16, large: 18, extra: 20 }[
              draft.textSize
            ],
          }}
        >
          <span>✦ A little preview</span>
          <h3>Little things. Big growing.</h3>
          <p>Your shared plans, family moments, and everyday wins.</p>
          <strong
            style={{ color: themes.find((t) => t.id === draft.theme)?.color }}
          >
            Made for your team
          </strong>
        </div>
        <label>
          Text size
          <select
            aria-label="Text size"
            value={draft.textSize}
            onChange={(e) =>
              change("textSize", e.target.value as Appearance["textSize"])
            }
          >
            <option value="small">Small</option>
            <option value="standard">Standard</option>
            <option value="large">Large</option>
            <option value="extra">Extra large</option>
          </select>
        </label>
        <label>
          Background
          <select
            aria-label="Background"
            value={draft.background}
            onChange={(e) => change("background", e.target.value)}
          >
            {backgrounds.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
            {photos.map((p) => (
              <option key={p.id} value={"photo:" + p.id}>
                {p.caption || "Gallery photo"}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Add an image in Photo gallery to use it here. Child defaults can use
          only photos shared with your child.
        </p>
        {draft.background.startsWith("photo:") && (
          <label>
            Photo readability overlay: {draft.photoOverlay}%
            <input
              aria-label="Photo readability overlay"
              type="range"
              min={65}
              max={95}
              step={1}
              value={draft.photoOverlay}
              onChange={(e) => change("photoOverlay", Number(e.target.value))}
            />
          </label>
        )}
        <label>
          Spacing
          <select
            aria-label="Spacing"
            value={draft.spacing}
            onChange={(e) =>
              change("spacing", e.target.value as Appearance["spacing"])
            }
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact lists</option>
          </select>
        </label>
        <label>
          Card style
          <select
            aria-label="Card style"
            value={draft.cardStyle}
            onChange={(e) =>
              change("cardStyle", e.target.value as Appearance["cardStyle"])
            }
          >
            <option value="soft">Soft & rounded</option>
            <option value="outlined">Clear outlines</option>
            <option value="flat">Simple & flat</option>
          </select>
        </label>
        {bool("highContrast", "Higher contrast")}
        {bool("reduceMotion", "Reduce motion")}
      </fieldset>
      <fieldset disabled={busy || (data.role === "child" && inherit)}>
        <legend>App behavior</legend>
        <label>
          Start page
          <select
            aria-label="Start page"
            value={draft.startPage}
            onChange={(e) => change("startPage", e.target.value)}
          >
            {(isChild
              ? [
                  ["today", "My day"],
                  ["rewards", "Rewards"],
                  ["gallery", "Photos"],
                  ["resources", "Discover"],
                ]
              : [
                  ["today", "Today"],
                  ["chat", "Parent chat"],
                  ["gallery", "Photo gallery"],
                  ["routines", "Routines & chores"],
                ]
            ).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">Used the next time this account opens the app.</p>
        <label>
          Time display
          <select
            aria-label="Time display"
            value={draft.timeFormat}
            onChange={(e) =>
              change("timeFormat", e.target.value as Appearance["timeFormat"])
            }
          >
            <option value="system">Follow this device</option>
            <option value="12h">12-hour clock</option>
            <option value="24h">24-hour clock</option>
          </select>
        </label>
        {!isChild &&
          bool(
            "dashboardSummaries",
            "Show pickup, homework, and routine summaries on Today",
          )}
      </fieldset>
      {childDefault && (
        <fieldset disabled={busy}>
          <legend>Child location privacy</legend>
          <label className="check-label">
            <input
              type="checkbox"
              checked={allowLocation}
              onChange={(e) => {
                setAllowLocation(e.target.checked);
                setDirty(true);
                key.current = crypto.randomUUID();
              }}
            />
            Allow the child account to share its device location with parents
          </label>
          <p className="muted">
            This permission never starts tracking. Someone must also choose to
            share on the child's device and grant its browser location
            permission. Turning this off removes the saved child location.
          </p>
        </fieldset>
      )}
      {dirty && currentVersion !== baseline.current && (
        <p className="error" role="alert">
          These settings changed in another session. Your draft is kept; load
          saved settings before replacing it.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <div className="hub-actions">
        <button disabled={busy}>
          {busy
            ? "Saving…"
            : childDefault
              ? "Save child defaults"
              : "Save app settings"}
        </button>
        <button
          className="secondary"
          type="button"
          disabled={busy}
          onClick={load}
        >
          Load saved settings
        </button>
        <button
          className="text"
          type="button"
          disabled={busy}
          onClick={() => {
            setDraft(normalizedAppearance(defaultAppearance));
            setDirty(true);
            key.current = crypto.randomUUID();
          }}
        >
          Reset all app settings
        </button>
      </div>
    </form>
  );
}
