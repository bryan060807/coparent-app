"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { displayTime } from "../lib/appearance";
import type { LocationView, LocationFix } from "../lib/hub-types";
import FamilyMap from "./family-map";
import { preferFix, improvedFix, accuracyLabel } from "../lib/location-quality";
type LocationContext = {
  data: LocationView | null;
  error: string;
  busy: boolean;
  thisDevice: boolean;
  start: (hours: number) => Promise<void>;
  stop: () => Promise<void>;
  refresh: () => Promise<void>;
};
const SharingContext = createContext<LocationContext | null>(null);
const storageKey = (viewer: string) => "team-location-grant:" + viewer;
const localGrant = (viewer: string) => {
  try {
    return localStorage.getItem(storageKey(viewer));
  } catch {
    return null;
  }
};
const saveGrant = (viewer: string, grant: string | null) => {
  try {
    if (grant) localStorage.setItem(storageKey(viewer), grant);
    else localStorage.removeItem(storageKey(viewer));
  } catch {}
};
const fromPosition = (p: GeolocationPosition): LocationFix => ({
  latitude: p.coords.latitude,
  longitude: p.coords.longitude,
  accuracy: p.coords.accuracy,
  capturedAt: p.timestamp,
});
function gpsError(e: GeolocationPositionError) {
  return e.code === 1
    ? "Location permission was denied. Allow it in this browser's site settings to share, or leave sharing off."
    : e.code === 2
      ? "This device couldn't find a location. The map will keep the timestamp of the last saved point."
      : "A fresh location took too long. Check GPS and try again.";
}
export function FamilyLocationProvider({
  viewer,
  children,
}: {
  viewer: string;
  children: React.ReactNode;
}) {
  const [data, setData] = useState<LocationView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [thisDevice, setThisDevice] = useState(false);
  const live = useRef(true),
    generation = useRef(0),
    current = useRef<LocationView | null>(null),
    latestFix = useRef<LocationFix | null>(null),
    lastFixSent = useRef<LocationFix | null>(null),
    lastSent = useRef(0),
    sending = useRef(false),
    halt = useRef<null | (() => void)>(null);
  const accept = useCallback(
    (b: LocationView) => {
      if (!live.current) return;
      if (b.viewer !== viewer) {
        setData(null);
        current.current = null;
        window.dispatchEvent(new Event("team-account-change"));
        return;
      }
      current.current = b;
      setData(b);
    },
    [viewer],
  );
  const request = useCallback(
    async (body?: Record<string, unknown>) => {
      const r = await fetch(
        "/api/location",
        body
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...body, viewer }),
              cache: "no-store",
            }
          : { cache: "no-store" },
      );
      const b = await r.json();
      if (!r.ok)
        throw Object.assign(Error(b.error ?? "Could not update sharing."), {
          status: r.status,
        });
      return b as LocationView;
    },
    [viewer],
  );
  const refresh = useCallback(async () => {
    const ticket = ++generation.current;
    try {
      const b = await request();
      if (ticket === generation.current) accept(b);
    } catch (e) {
      if (live.current && ticket === generation.current)
        setError((e as Error).message);
    }
  }, [request, accept]);
  useEffect(() => {
    live.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live.current = false;
      ++generation.current;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);
  const stop = useCallback(async () => {
    const d = current.current;
    if (!d) return;
    halt.current?.();
    saveGrant(viewer, null);
    setThisDevice(false);
    setBusy(true);
    setError("");
    try {
      const b = await request({
        action: "stop",
        version: d.controlVersion,
        key: crypto.randomUUID(),
      });
      ++generation.current;
      saveGrant(viewer, null);
      setThisDevice(false);
      accept(b);
    } catch (e) {
      await refresh();
      if (live.current)
        setError(
          "This device stopped updating, but the server could not remove the last point. Retry when connected; the point may remain visible until sharing expires.",
        );
    } finally {
      if (live.current) setBusy(false);
    }
  }, [request, viewer, accept, refresh]);
  useEffect(() => {
    const grant = data?.own?.grant;
    if (
      !grant ||
      localGrant(viewer) !== grant ||
      !data?.allowed ||
      data.own!.expires <= data.serverTime ||
      !navigator.geolocation
    ) {
      setThisDevice(false);
      return;
    }
    let active = true;
    setThisDevice(true);
    lastSent.current = 0;
    lastFixSent.current = null;
    const send = async () => {
      const fix = latestFix.current;
      if (
        !active ||
        !fix ||
        sending.current ||
        (Date.now() - lastSent.current < 30000 &&
          !improvedFix(lastFixSent.current, fix)) ||
        lastFixSent.current?.capturedAt === fix?.capturedAt
      )
        return;
      sending.current = true;
      lastSent.current = Date.now();
      try {
        const b = await request({ action: "point", grant, fix });
        if (active) {
          lastFixSent.current = fix;
          ++generation.current;
          accept(b);
          setError("");
        }
      } catch (e) {
        if (active) {
          setError((e as Error).message);
          if (
            [401, 403, 409].includes(
              (e as Error & { status?: number }).status ?? 0,
            )
          ) {
            halt.current?.();
            saveGrant(viewer, null);
            setThisDevice(false);
            await refresh();
          }
        }
      } finally {
        sending.current = false;
        if (active && latestFix.current && improvedFix(fix, latestFix.current))
          void send();
      }
    };
    const watcher = navigator.geolocation.watchPosition(
      (p) => {
        const fix = fromPosition(p);
        if (preferFix(latestFix.current, fix)) latestFix.current = fix;
        void send();
      },
      (e) => {
        if (!active) return;
        setError(gpsError(e));
        if (e.code === 1) {
          saveGrant(viewer, null);
          void stop();
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
    void send();
    const timer = setInterval(() => void send(), 30000);
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      active = false;
      navigator.geolocation.clearWatch(watcher);
      clearInterval(timer);
      if (expiryTimer) clearTimeout(expiryTimer);
      latestFix.current = null;
    };
    halt.current = cleanup;
    expiryTimer = setTimeout(
      () => {
        cleanup();
        saveGrant(viewer, null);
        setThisDevice(false);
        const d = current.current;
        if (d?.own?.grant === grant)
          accept({
            ...d,
            own: null,
            people: d.people.map((p) =>
              p.id === viewer
                ? { ...p, sharing: false, fix: undefined, expires: undefined }
                : p,
            ),
          });
        void refresh().finally(() => {
          if (live.current)
            setError(
              "Your sharing period ended. Start a new session if you want to share again.",
            );
        });
      },
      Math.max(0, data.own!.expires - data.serverTime),
    );
    return () => {
      cleanup();
      if (halt.current === cleanup) halt.current = null;
    };
  }, [data?.own?.grant, data?.allowed, viewer, request, accept, refresh, stop]);
  const start = async (hours: number) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!navigator.geolocation || !window.isSecureContext)
        throw Error(
          "Location sharing needs HTTPS and a browser with location support.",
        );
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) =>
          navigator.geolocation.getCurrentPosition(
            resolve,
            (e) => reject(Error(gpsError(e))),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
          ),
      );
      if (!live.current) return;
      const d = current.current;
      if (!d?.allowed)
        throw Error("A parent needs to allow child location sharing first.");
      const b = await request({
        action: "start",
        version: d.controlVersion,
        hours,
        consent: true,
        key: crypto.randomUUID(),
      });
      if (!b.own) throw Error("Sharing changed. Please try again.");
      saveGrant(viewer, b.own.grant);
      latestFix.current = fromPosition(position);
      ++generation.current;
      accept(b);
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      if (live.current) setBusy(false);
    }
  };
  return (
    <SharingContext.Provider
      value={{ data, error, busy, thisDevice, start, stop, refresh }}
    >
      {children}
    </SharingContext.Provider>
  );
}
export function SharingStatus() {
  const c = useContext(SharingContext);
  if (!c?.data?.own) return null;
  return (
    <aside className="sharing-banner" role="status">
      <span aria-hidden="true">📍</span>
      <span>
        {c.thisDevice
          ? "This device is sharing its location with your household's parents."
          : "A sharing session is saved for this account; this browser is not updating it."}{" "}
        Until {displayTime(c.data.own.expires)}.
      </span>
      <button
        className="secondary"
        disabled={c.busy}
        onClick={() => void c.stop()}
      >
        Stop sharing
      </button>
    </aside>
  );
}
function ago(at: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  return minutes === 0
    ? "just now"
    : minutes < 60
      ? `${minutes} min ago`
      : `${Math.floor(minutes / 60)} hr ${minutes % 60} min ago`;
}
export function LocationPanel() {
  const c = useContext(SharingContext);
  const [consent, setConsent] = useState(false),
    [hours, setHours] = useState(8),
    [showMap, setShowMap] = useState(false);
  useEffect(() => {
    if (!c?.data?.own) setConsent(false);
  }, [c?.data?.own?.grant]);
  if (!c) return null;
  const { data, error, busy } = c;
  if (!data)
    return (
      <section>
        <h1>Family location</h1>
        <p role={error ? "alert" : "status"}>
          {error || "Loading sharing status…"}
        </p>
        <button className="secondary" onClick={() => void c.refresh()}>
          Retry
        </button>
      </section>
    );
  const parent = data.role === "parent",
    points = data.people.filter((p) => p.fix);
  return (
    <section className="location-panel">
      <p className="section-kicker">Shared by choice</p>
      <h1>{parent ? "Family map" : "My location"}</h1>
      <p>
        {parent
          ? "Find a recently shared position when someone is hard to reach. Each person chooses to share from their own device; only this household's parents can view the family map."
          : "You can share where this device is with your parents. You can stop whenever you want. You cannot see anyone else's location here."}
      </p>
      <details className="note location-guide">
        <summary>How sharing and last-known locations work</summary>
        <p>
          The app updates while it is open and the device can get a location. A
          closed, sleeping, offline, or unpowered phone may stop updating.
          Closing the app or signing out leaves the last point visible until
          sharing expires or is stopped. Timestamps and accuracy show how much
          to rely on each point.
        </p>
        <p>
          Laptops often estimate location from Wi-Fi or an internet connection
          and can place you in the wrong city. Most have no GPS. For a more
          accurate position, share from your phone with precise location
          enabled. The accuracy radius is the device's estimate, not a
          guarantee.
        </p>
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {parent && points.length > 0 && (
        <>
          {showMap ? (
            <FamilyMap people={points} />
          ) : (
            <button className="secondary" onClick={() => setShowMap(true)}>
              Load family map
            </button>
          )}
          <p className="muted">
            Map tiles come from OpenStreetMap when you load the map; tile
            requests reveal the area being viewed to that provider. Saved
            coordinates remain private to your household. No route history is
            stored.
          </p>
        </>
      )}

      <article className="hub-card">
        <h2>Sharing from my device</h2>
        {data.own ? (
          <>
            <p>
              {c.thisDevice
                ? "Sharing from this device"
                : "A saved sharing session is active; this browser is not updating it"}
              . Expires {displayTime(data.own.expires)}.
            </p>
            <p>
              {data.own.fix
                ? `Last saved ${ago(data.own.fix.capturedAt)} · ${displayTime(data.own.fix.capturedAt)}`
                : "Waiting for a location fix."}
            </p>
            {data.own.fix && (
              <p role="status">
                Device-reported accuracy: about{" "}
                {accuracyLabel(data.own.fix.accuracy)}.
                {data.own.fix.accuracy > 100 &&
                  " Approximate area only. Try a phone with precise location enabled."}
              </p>
            )}
            <button disabled={busy} onClick={() => void c.stop()}>
              Stop sharing & remove my point
            </button>
          </>
        ) : !data.allowed ? (
          <p>
            A parent needs to enable child sharing in{" "}
            <strong>App settings → Child defaults</strong>. That permission
            still leaves the choice to start or stop on this device.
          </p>
        ) : (
          <>
            <p>Off. No location is being collected from this device.</p>
            <label>
              Share for
              <select
                aria-label="Share for"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              >
                <option value={1}>1 hour</option>
                <option value={8}>8 hours</option>
                <option value={24}>24 hours</option>
              </select>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              I want to share this device's location with the household's
              parents for the selected time.
            </label>
            <button
              disabled={!consent || busy}
              onClick={() => void c.start(hours)}
            >
              {busy
                ? "Waiting for location permission…"
                : "Start sharing my location"}
            </button>
          </>
        )}
      </article>
      {parent && (
        <>
          <h2>Your team</h2>
          {data.people.map((p) => (
            <article className="hub-card location-person" key={p.id}>
              <div>
                <h3>
                  {p.name}{" "}
                  <small>{p.role === "child" ? "Child" : "Parent"}</small>
                </h3>
                <span
                  className={
                    "hub-chip " +
                    (p.fix && Date.now() - p.fix.capturedAt > 120000
                      ? "stale-location"
                      : "")
                  }
                >
                  {!p.sharing
                    ? "Not sharing"
                    : !p.fix
                      ? "Waiting for location"
                      : Date.now() - p.fix.capturedAt > 120000
                        ? "Last known · may be out of date"
                        : p.fix.accuracy > 100
                          ? "Approximate area · recently updated"
                          : "Recently updated"}
                </span>
              </div>
              {p.fix && (
                <>
                  <p>
                    <strong>{ago(p.fix.capturedAt)}</strong> ·{" "}
                    {displayTime(p.fix.capturedAt)}
                  </p>
                  <p>
                    Accuracy: about {accuracyLabel(p.fix.accuracy)}. This is an
                    approximate device position.
                  </p>
                  {p.fix.accuracy > 100 && (
                    <p className="note">
                      Low accuracy — do not treat the pin as an exact address. A
                      laptop may report a different city; a phone with precise
                      location can give a better fix.
                    </p>
                  )}
                  <p className="location-coordinates">
                    {p.fix.latitude.toFixed(5)}, {p.fix.longitude.toFixed(5)}
                  </p>
                  <a
                    className="attachment"
                    href={`https://www.google.com/maps/search/?api=1&query=${p.fix.latitude},${p.fix.longitude}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Open this point in Maps ↗
                  </a>
                </>
              )}
            </article>
          ))}
          <p className="muted">
            Sharing expires automatically. Stopping removes the saved point.
            Child permission changes and child password resets also revoke child
            sharing. Status checks refresh about every 15 seconds while the app
            is open.
          </p>
        </>
      )}
    </section>
  );
}
