"use client";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";
import type { FamilyLocation } from "../lib/hub-types";
import { displayTime } from "../lib/appearance";
export default function FamilyMap({ people }: { people: FamilyLocation[] }) {
  const node = useRef<HTMLDivElement>(null),
    map = useRef<LeafletMap | null>(null),
    layers = useRef<LayerGroup | null>(null),
    first = useRef(true),
    [ready, setReady] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void import("leaflet")
      .then((L) => {
        if (!active || !node.current) return;
        const m = L.map(node.current, { scrollWheelZoom: false });
        map.current = m;
        layers.current = L.layerGroup().addTo(m);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        })
          .on("tileerror", () => {
            if (active)
              setError(
                "Map tiles could not load. The saved coordinates and timestamps above still work.",
              );
          })
          .addTo(m);
        setReady(true);
      })
      .catch(() =>
        setError(
          "The map could not load. You can still open each saved point in Maps.",
        ),
      );
    return () => {
      active = false;
      map.current?.remove();
      map.current = null;
      layers.current = null;
    };
  }, []);
  const pointsKey = JSON.stringify(
    people.map((p) => ({
      ...p,
      stale: !!p.fix && Date.now() - p.fix.capturedAt > 120000,
    })),
  );
  useEffect(() => {
    if (!ready || !map.current || !layers.current) return;
    let live = true;
    void import("leaflet").then((L) => {
      if (!live || !map.current || !layers.current) return;
      layers.current.clearLayers();
      const coords: [number, number][] = [];
      for (const p of people) {
        if (!p.fix) continue;
        const latlng: [number, number] = [p.fix.latitude, p.fix.longitude];
        coords.push(latlng);
        const popup = document.createElement("div"),
          name = document.createElement("strong"),
          at = document.createElement("p");
        name.textContent = p.name;
        at.textContent = `${Date.now() - p.fix.capturedAt > 120000 ? "Last known (may be out of date)" : "Last saved"} ${displayTime(p.fix.capturedAt)} · about ${Math.round(p.fix.accuracy)} m accuracy`;
        popup.append(name, at);
        L.marker(latlng, {
          title: p.name,
          icon: L.divIcon({
            className:
              "family-map-marker" +
              (Date.now() - p.fix.capturedAt > 120000
                ? " stale-map-marker"
                : ""),
            html: p.role === "child" ? "★" : "●",
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
        })
          .bindPopup(popup)
          .addTo(layers.current);
        L.circle(latlng, {
          radius: Math.max(5, p.fix.accuracy),
          weight: 1,
          fillOpacity: 0.1,
          color: "#1d526a",
        }).addTo(layers.current);
      }
      if (first.current && coords.length) {
        map.current.fitBounds(L.latLngBounds(coords), {
          padding: [32, 32],
          maxZoom: 15,
        });
        first.current = false;
      }
    });
    return () => {
      live = false;
    };
  }, [pointsKey, ready]);
  return (
    <div className="family-map-wrap">
      {error && (
        <p className="error" role="status">
          {error}
        </p>
      )}
      <div
        ref={node}
        className="family-map"
        role="region"
        aria-label="Map of voluntarily shared family locations"
      />
      <button
        className="secondary"
        onClick={() => {
          const coords = people
            .filter((p) => p.fix)
            .map(
              (p) => [p.fix!.latitude, p.fix!.longitude] as [number, number],
            );
          if (coords.length)
            void import("leaflet").then((L) =>
              map.current?.fitBounds(L.latLngBounds(coords), {
                padding: [32, 32],
                maxZoom: 15,
              }),
            );
        }}
      >
        Show all shared points
      </button>
    </div>
  );
}
