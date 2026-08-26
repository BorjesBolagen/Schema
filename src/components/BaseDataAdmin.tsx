"use client";

import { useState, useTransition } from "react";
import {
  createEmployee,
  setStationPlaceForMany,
  createStation,
  createVehicle,
  deleteStation,
  editEmployee,
  editStation,
  editVehicle,
} from "@/app/basedata-actions";
import type { ManagedEmployee, ManagedStation, ManagedVehicle } from "@/server/basedata";

interface Props {
  stations: ManagedStation[];
  employees: ManagedEmployee[];
  vehicles: ManagedVehicle[];
}

type Tab = "personal" | "fordon" | "orter";

const field =
  "rounded border border-(--color-line) bg-white px-3 py-2 text-sm text-(--color-ink)";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "personal", label: "Personal" },
  { id: "fordon", label: "Fordon" },
  { id: "orter", label: "Stationsorter" },
];

export function BaseDataAdmin({ stations, employees, vehicles }: Props) {
  const [tab, setTab] = useState<Tab>("personal");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      setError(result.ok ? null : (result.error ?? "Något gick fel."));
      if (result.ok) after?.();
    });

  return (
    <>
      <div className="mt-6 flex gap-1 border-b border-(--color-line)">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTab(t.id);
              setError(null);
            }}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              tab === t.id
                ? "border-(--color-accent) font-medium text-(--color-accent)"
                : "border-transparent text-(--color-muted)"
            }`}
          >
            {t.label}
            <span className="ml-2 text-xs text-(--color-muted)">
              {t.id === "personal" ? employees.length : t.id === "fordon" ? vehicles.length : stations.length}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-(--color-danger)">
          {error}
        </p>
      )}

      {tab === "personal" && (
        <EmployeeTab employees={employees} stations={stations} pending={pending} run={run} />
      )}
      {tab === "fordon" && (
        <VehicleTab vehicles={vehicles} stations={stations} pending={pending} run={run} />
      )}
      {tab === "orter" && <StationTab stations={stations} pending={pending} run={run} />}
    </>
  );
}

type Run = (
  fn: () => Promise<{ ok: boolean; error?: string }>,
  after?: () => void,
) => void;

/* ------------------------------------------------------------------ *
 * Personal
 * ------------------------------------------------------------------ */

function EmployeeTab({
  employees,
  stations,
  pending,
  run,
}: {
  employees: ManagedEmployee[];
  stations: ManagedStation[];
  pending: boolean;
  run: Run;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [stationPlaceId, setStationPlaceId] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [query, setQuery] = useState("");
  const [onlyWithout, setOnlyWithout] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkStation, setBulkStation] = useState("");

  const shown = employees.filter((e) => {
    if (!showInactive && !e.isActive) return false;
    if (onlyWithout && e.stationPlaceId) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      (e.employeeNumber ?? "").includes(q)
    );
  });

  /* Kryssrutan i huvudet gäller det som syns, inte hela registret —
     annars skulle ett filter kunna dölja vem man råkar ändra på. */
  const allShownPicked = shown.length > 0 && shown.every((e) => picked.has(e.id));
  const toggleAllShown = () =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const e of shown) allShownPicked ? next.delete(e.id) : next.add(e.id);
      return next;
    });

  const applyStation = () =>
    run(
      () => setStationPlaceForMany([...picked], bulkStation || null),
      () => setPicked(new Set()),
    );

  const add = () =>
    run(
      () => createEmployee({ firstName, lastName, employeeNumber, stationPlaceId }),
      () => {
        setFirstName("");
        setLastName("");
        setEmployeeNumber("");
      },
    );

  return (
    <>
      <div className="mt-5 flex flex-wrap items-end gap-2 rounded border border-(--color-line) bg-white p-4">
        <label className="text-xs text-(--color-muted)">
          Förnamn
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={`mt-1 block w-36 ${field}`} />
        </label>
        <label className="text-xs text-(--color-muted)">
          Efternamn
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={`mt-1 block w-40 ${field}`} />
        </label>
        <label className="text-xs text-(--color-muted)">
          Anst.nr
          <input value={employeeNumber} onChange={(e) => setEmployeeNumber(e.target.value)} className={`mt-1 block w-24 ${field}`} />
        </label>
        <label className="text-xs text-(--color-muted)">
          Stationsort
          <select
            value={stationPlaceId}
            onChange={(e) => setStationPlaceId(e.target.value)}
            className={`mt-1 block w-40 ${field}`}
          >
            <option value="">—</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={add}
          disabled={pending || !firstName.trim() || !lastName.trim()}
          className="rounded bg-(--color-accent) px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Lägg till
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Sök namn eller anst.nr …"
          aria-label="Sök personal"
          className={`w-56 ${field}`}
        />
        <label className="flex items-center gap-2 text-xs text-(--color-muted)">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Visa avslutade
        </label>
        <label className="flex items-center gap-2 text-xs text-(--color-muted)">
          <input type="checkbox" checked={onlyWithout} onChange={(e) => setOnlyWithout(e.target.checked)} />
          Bara utan stationsort
        </label>
        <span className="text-xs text-(--color-muted)">{shown.length} visas</span>
      </div>

      {picked.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded border border-(--color-accent) bg-amber-50 px-4 py-2">
          <span className="text-sm font-medium">{picked.size} valda</span>
          <label className="text-xs text-(--color-muted)">
            Sätt stationsort
            <select
              value={bulkStation}
              onChange={(e) => setBulkStation(e.target.value)}
              className={`mt-1 block w-40 ${field}`}
            >
              <option value="">— (ingen)</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={applyStation}
            disabled={pending}
            className="rounded bg-(--color-accent) px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Sätt på {picked.size}
          </button>
          <button
            onClick={() => setPicked(new Set())}
            className="text-xs text-(--color-muted) hover:underline"
          >
            Avmarkera
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="mt-4 text-sm text-(--color-muted)">Ingen personal ännu.</p>
      ) : (
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs tracking-wide text-(--color-muted) uppercase">
              <th className="py-2 pr-2 font-medium">
                <input
                  type="checkbox"
                  checked={allShownPicked}
                  onChange={toggleAllShown}
                  aria-label="Markera alla som visas"
                />
              </th>
              <th className="py-2 pr-4 font-medium">Namn</th>
              <th className="py-2 pr-4 font-medium">Anst.nr</th>
              <th className="py-2 pr-4 font-medium">Stationsort</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id} className={`border-t border-(--color-line) ${e.isActive ? "" : "opacity-50"}`}>
                <td className="py-2 pr-2">
                  <input
                    type="checkbox"
                    checked={picked.has(e.id)}
                    onChange={() =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        next.has(e.id) ? next.delete(e.id) : next.add(e.id);
                        return next;
                      })
                    }
                    aria-label={`Markera ${e.firstName} ${e.lastName}`}
                  />
                </td>
                <td className="py-2 pr-4">
                  {e.firstName} {e.lastName}
                  {e.fromTranspa && (
                    <span className="ml-2 text-[11px] text-(--color-muted)">från TransPA</span>
                  )}
                </td>
                <td className="py-2 pr-4 text-xs text-(--color-muted)">{e.employeeNumber ?? "—"}</td>
                <td className="py-2 pr-4">
                  <select
                    value={e.stationPlaceId ?? ""}
                    onChange={(ev) => run(() => editEmployee(e.id, { stationPlaceId: ev.target.value }))}
                    className="rounded border border-(--color-line) bg-white px-2 py-1 text-xs"
                  >
                    <option value="">—</option>
                    {stations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => run(() => editEmployee(e.id, { isActive: !e.isActive }))}
                    disabled={pending}
                    className="text-xs text-(--color-muted) hover:underline"
                  >
                    {e.isActive ? "Avsluta" : "Återaktivera"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Fordon
 * ------------------------------------------------------------------ */

function VehicleTab({
  vehicles,
  stations,
  pending,
  run,
}: {
  vehicles: ManagedVehicle[];
  stations: ManagedStation[];
  pending: boolean;
  run: Run;
}) {
  const [displayName, setDisplayName] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [stationPlaceId, setStationPlaceId] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const shown = vehicles.filter((v) => showInactive || v.isActive);

  const add = () =>
    run(
      () => createVehicle({ displayName, registrationNumber, stationPlaceId }),
      () => {
        setDisplayName("");
        setRegistrationNumber("");
      },
    );

  return (
    <>
      <div className="mt-5 flex flex-wrap items-end gap-2 rounded border border-(--color-line) bg-white p-4">
        <label className="text-xs text-(--color-muted)">
          Bilnamn
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="BT08"
            className={`mt-1 block w-32 ${field}`}
          />
        </label>
        <label className="text-xs text-(--color-muted)">
          Reg.nr
          <input
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            className={`mt-1 block w-32 ${field}`}
          />
        </label>
        <label className="text-xs text-(--color-muted)">
          Stationsort
          <select
            value={stationPlaceId}
            onChange={(e) => setStationPlaceId(e.target.value)}
            className={`mt-1 block w-40 ${field}`}
          >
            <option value="">—</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={add}
          disabled={pending || !displayName.trim()}
          className="rounded bg-(--color-accent) px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Lägg till
        </button>
      </div>

      <label className="mt-4 flex items-center gap-2 text-xs text-(--color-muted)">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        Visa avställda
      </label>

      {shown.length === 0 ? (
        <p className="mt-4 text-sm text-(--color-muted)">Inga fordon ännu.</p>
      ) : (
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs tracking-wide text-(--color-muted) uppercase">
              <th className="py-2 pr-4 font-medium">Bil</th>
              <th className="py-2 pr-4 font-medium">Reg.nr</th>
              <th className="py-2 pr-4 font-medium">Stationsort</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {shown.map((v) => (
              <tr key={v.id} className={`border-t border-(--color-line) ${v.isActive ? "" : "opacity-50"}`}>
                <td className="py-2 pr-4">
                  <input
                    defaultValue={v.displayName}
                    onBlur={(e) =>
                      e.target.value !== v.displayName &&
                      run(() => editVehicle(v.id, { displayName: e.target.value }))
                    }
                    className="w-28 rounded border border-transparent px-2 py-1 hover:border-(--color-line) focus:border-(--color-line) focus:bg-white"
                  />
                  {v.fromTranspa && (
                    <span className="ml-2 text-[11px] text-(--color-muted)">från TransPA</span>
                  )}
                </td>
                <td className="py-2 pr-4 text-xs text-(--color-muted)">{v.registrationNumber ?? "—"}</td>
                <td className="py-2 pr-4">
                  <select
                    value={v.stationPlaceId ?? ""}
                    onChange={(ev) => run(() => editVehicle(v.id, { stationPlaceId: ev.target.value }))}
                    className="rounded border border-(--color-line) bg-white px-2 py-1 text-xs"
                  >
                    <option value="">—</option>
                    {stations.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => run(() => editVehicle(v.id, { isActive: !v.isActive }))}
                    disabled={pending}
                    className="text-xs text-(--color-muted) hover:underline"
                  >
                    {v.isActive ? "Ställ av" : "Ta i bruk"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Stationsorter
 * ------------------------------------------------------------------ */

function StationTab({
  stations,
  pending,
  run,
}: {
  stations: ManagedStation[];
  pending: boolean;
  run: Run;
}) {
  const [name, setName] = useState("");

  return (
    <>
      <div className="mt-5 flex flex-wrap items-end gap-2 rounded border border-(--color-line) bg-white p-4">
        <label className="text-xs text-(--color-muted)">
          Ort
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && name.trim() && run(() => createStation(name), () => setName(""))
            }
            placeholder="Nybro"
            className={`mt-1 block w-40 ${field}`}
          />
        </label>
        <button
          onClick={() => run(() => createStation(name), () => setName(""))}
          disabled={pending || !name.trim()}
          className="rounded bg-(--color-accent) px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Lägg till
        </button>
      </div>

      <p className="mt-4 max-w-[68ch] text-xs text-(--color-muted)">
        Orten är det personalväljaren filtrerar på — den som gör listan hanterbar när hela
        personalregistret ligger i den.
      </p>

      {stations.length === 0 ? (
        <p className="mt-4 text-sm text-(--color-muted)">Inga orter ännu.</p>
      ) : (
        <ul className="mt-3 divide-y divide-(--color-line)">
          {stations.map((s) => (
            <li key={s.id} className="flex items-center gap-4 py-2">
              <input
                defaultValue={s.name}
                onBlur={(e) =>
                  e.target.value !== s.name && run(() => editStation(s.id, e.target.value))
                }
                className="flex-1 rounded border border-transparent px-2 py-1 text-sm hover:border-(--color-line) focus:border-(--color-line) focus:bg-white"
              />
              {s.fromTranspa && <span className="text-[11px] text-(--color-muted)">från TransPA</span>}
              <button
                onClick={() => run(() => deleteStation(s.id))}
                disabled={pending}
                className="text-xs text-(--color-muted) hover:underline"
              >
                Ta bort
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
