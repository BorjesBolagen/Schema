import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

/** Om en tavelrad står för en resurs (bil/linje) eller för en person. */
export const rowKind = pgEnum("row_kind", ["resource", "person"]);

/** Vilken vy en tavla öppnas i. Samma data, olika axlar. */
export const viewMode = pgEnum("view_mode", ["resource", "person"]);

export const absenceType = pgEnum("absence_type", [
  "semester",
  "sjuk",
  "vab",
  "tjanstledig",
  "foraldraledig",
  "kompledig",
  "ovrig",
]);

export const absenceStatus = pgEnum("absence_status", ["requested", "approved"]);

export const boardRole = pgEnum("board_role", ["editor", "viewer"]);

export const userRole = pgEnum("user_role", ["admin", "planner"]);

export const aliasSource = pgEnum("alias_source", ["excel", "manual", "transpa"]);

export const syncStatus = pgEnum("sync_status", ["running", "ok", "failed"]);

/* ------------------------------------------------------------------ *
 * Användare
 * ------------------------------------------------------------------ */

export const appUser = pgTable("app_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: userRole("role").notNull().default("planner"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ *
 * Masterdata från TransPA
 *
 * Dessa tabeller speglar TransPA och skrivs bara av synken. Lokala
 * tillägg (t.ex. vehicle.displayName) ligger i samma tabell men rörs
 * aldrig av synken — se lib/transpa/sync.ts.
 * ------------------------------------------------------------------ */

export const trafficArea = pgTable("traffic_area", {
  id: uuid("id").primaryKey().defaultRandom(),
  transpaId: text("transpa_id").unique(),
  name: text("name").notNull(),
});

export const stationPlace = pgTable("station_place", {
  id: uuid("id").primaryKey().defaultRandom(),
  transpaId: text("transpa_id").unique(),
  name: text("name").notNull(),
  supervisorPhoneNumber: text("supervisor_phone_number"),
  emergencyPhoneNumber: text("emergency_phone_number"),
});

export const vehicleGroup = pgTable("vehicle_group", {
  id: uuid("id").primaryKey().defaultRandom(),
  transpaId: text("transpa_id").unique(),
  name: text("name").notNull(),
});

export const employee = pgTable(
  "employee",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transpaId: text("transpa_id").unique(),
    /** Anställningsnummer — nyckeln som Personallista och TransPA delar. */
    employeeNumber: text("employee_number").unique(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    signature: text("signature"),
    isActive: boolean("is_active").notNull().default(true),

    /** Textvärden ur Personallista. Behålls även efter TransPA-synk. */
    trafficAreaText: text("traffic_area_text"),
    stationPlaceText: text("station_place_text"),
    vacationGroup: text("vacation_group"),
    workGroup: text("work_group"),
    supervisor: text("supervisor"),
    email: text("email"),
    phone: text("phone"),

    /** Kopplingar som fylls först när TransPA-synken körts. */
    trafficAreaId: uuid("traffic_area_id").references(() => trafficArea.id),
    stationPlaceId: uuid("station_place_id").references(() => stationPlace.id),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("employee_active_idx").on(t.isActive)],
);

export const vehicle = pgTable("vehicle", {
  id: uuid("id").primaryKey().defaultRandom(),
  transpaId: text("transpa_id").unique(),
  registrationNumber: text("registration_number"),
  /** TransPA:s externalId — hette tidigare VehicleNumber. */
  externalId: text("external_id"),
  /** Vad ni kallar bilen. Ägs lokalt, skrivs aldrig över av synken. */
  displayName: text("display_name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  trafficAreaId: uuid("traffic_area_id").references(() => trafficArea.id),
  stationPlaceId: uuid("station_place_id").references(() => stationPlace.id),
  vehicleGroupId: uuid("vehicle_group_id").references(() => vehicleGroup.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ *
 * Smeknamn
 *
 * Planerarna skriver "Elle", "Mylla", "Per H" — aldrig fullständiga
 * namn. Ett smeknamn kan betyda olika personer på olika tavlor
 * ("Anders" finns i flera trafikområden), därför är aliaset unikt per
 * tavla. boardId = null betyder att aliaset gäller överallt.
 * ------------------------------------------------------------------ */

export const employeeAlias = pgTable(
  "employee_alias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    /** Gemener + trimmad. Uppslag sker alltid mot den här. */
    aliasNormalized: text("alias_normalized").notNull(),
    boardId: uuid("board_id").references((): any => board.id, { onDelete: "cascade" }),
    source: aliasSource("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("employee_alias_scope_uq").on(t.aliasNormalized, t.boardId),
    index("employee_alias_employee_idx").on(t.employeeId),
  ],
);

/* ------------------------------------------------------------------ *
 * Tavlan
 *
 * Tavlan är den konfigurerbara vyn som en trafikansvarig äger. Rader,
 * namn, gruppering, ordning och vilka fält en cell visar styrs härifrån
 * — inte i koden.
 * ------------------------------------------------------------------ */

export const board = pgTable("board", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  trafficAreaId: uuid("traffic_area_id").references(() => trafficArea.id),
  ownerId: uuid("owner_id").references(() => appUser.id),

  /** 1 = måndag, 0 = söndag. Fjärrbladen börjar på söndag, lots på måndag. */
  weekStartsOn: integer("week_starts_on").notNull().default(1),
  /** Vilka veckodagar som visas, 0=sön … 6=lör. */
  visibleWeekdays: integer("visible_weekdays").array().notNull().default([1, 2, 3, 4, 5]),
  defaultViewMode: viewMode("default_view_mode").notNull().default("resource"),
  /** Delmängd av driver | vehicle | time | note. */
  cellFields: text("cell_fields").array().notNull().default(["driver", "vehicle"]),

  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const boardMember = pgTable(
  "board_member",
  {
    boardId: uuid("board_id")
      .notNull()
      .references(() => board.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    role: boardRole("role").notNull().default("editor"),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.userId] })],
);

export const boardGroup = pgTable(
  "board_group",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => board.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("board_group_board_idx").on(t.boardId, t.sortOrder)],
);

export const boardRow = pgTable(
  "board_row",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => board.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => boardGroup.id, { onDelete: "set null" }),

    /** Trafikansvariges eget namn på raden. Fritt — ingen koppling till bilnamnet. */
    label: text("label").notNull(),
    /** Andra kolumnen, typiskt linje eller ort. */
    sublabel: text("sublabel"),
    sortOrder: integer("sort_order").notNull().default(0),
    color: text("color"),

    kind: rowKind("kind").notNull().default("resource"),
    /** Föreslås i cellen, kan bytas per dag. */
    defaultVehicleId: uuid("default_vehicle_id").references(() => vehicle.id),
    /** Sätts bara för person-rader. */
    employeeId: uuid("employee_id").references(() => employee.id),

    /**
     * Inställda linjer avslutas med validTo i stället för att raderas,
     * så historiken finns kvar. Rader utanför sitt intervall visas inte
     * i veckovyn men deras gamla tilldelningar finns kvar.
     */
    validFrom: date("valid_from"),
    validTo: date("valid_to"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("board_row_board_idx").on(t.boardId, t.sortOrder)],
);

/* ------------------------------------------------------------------ *
 * Planeringsdata
 * ------------------------------------------------------------------ */

/**
 * En tilldelning = en förare på en rad en dag.
 *
 * slot finns för att en rad kan ha flera förare samma dag — era
 * fjärrblad har "NT/FIB", "Dahl/Leffe", "JOHAN/FANNY" där två personer
 * delar turen. Slot 0 är den första.
 */
export const assignment = pgTable(
  "assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardRowId: uuid("board_row_id")
      .notNull()
      .references(() => boardRow.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    slot: integer("slot").notNull().default(0),

    employeeId: uuid("employee_id").references(() => employee.id),
    vehicleId: uuid("vehicle_id").references(() => vehicle.id),
    startTime: time("start_time"),
    endTime: time("end_time"),
    note: text("note"),

    updatedBy: uuid("updated_by").references(() => appUser.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("assignment_cell_uq").on(t.boardRowId, t.date, t.slot),
    /* Konfliktdetektering slår mot de här två, tvärs över alla tavlor. */
    index("assignment_employee_date_idx").on(t.employeeId, t.date),
    index("assignment_vehicle_date_idx").on(t.vehicleId, t.date),
    index("assignment_date_idx").on(t.date),
  ],
);

export const absence = pgTable(
  "absence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.id, { onDelete: "cascade" }),
    fromDate: date("from_date").notNull(),
    /** Inklusive — en endagsfrånvaro har fromDate = toDate. */
    toDate: date("to_date").notNull(),
    type: absenceType("type").notNull().default("semester"),
    status: absenceStatus("status").notNull().default("approved"),
    note: text("note"),

    /**
     * Kvittensen på att frånvaron är inlagd i TransPA. Så länge
     * TransPA saknar frånvaro-endpoints sätts den manuellt av den som
     * knappat in den — se lib/transpa/absence-export.ts.
     */
    transpaSyncedAt: timestamp("transpa_synced_at", { withTimezone: true }),
    transpaSyncedBy: uuid("transpa_synced_by").references(() => appUser.id),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("absence_employee_range_idx").on(t.employeeId, t.fromDate, t.toDate)],
);

/* ------------------------------------------------------------------ *
 * Drift
 * ------------------------------------------------------------------ */

export const syncRun = pgTable("sync_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  resource: text("resource").notNull(),
  status: syncStatus("status").notNull().default("running"),
  itemCount: integer("item_count").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/**
 * Namn ur importen som inte gick att koppla till en person. Kastas inte
 * bort — de listas i appen för manuell koppling, och när någon väljer
 * person skapas ett employee_alias.
 */
export const unresolvedAlias = pgTable(
  "unresolved_alias",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    alias: text("alias").notNull(),
    aliasNormalized: text("alias_normalized").notNull(),
    boardId: uuid("board_id").references(() => board.id, { onDelete: "cascade" }),
    occurrences: integer("occurrences").notNull().default(1),
    sampleDate: date("sample_date"),
    resolvedEmployeeId: uuid("resolved_employee_id").references(() => employee.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("unresolved_alias_uq").on(t.aliasNormalized, t.boardId)],
);
