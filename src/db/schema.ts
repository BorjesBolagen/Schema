import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ *
 * Enums
 * ------------------------------------------------------------------ */

/** Ett pass är antingen dag eller natt. */
export const shift = pgEnum("shift", ["day", "night"]);

/** Om en tavelrad står för en resurs (bil/linje) eller för en person. */
export const rowKind = pgEnum("row_kind", ["resource", "person"]);

/** Vilken vy en tavla öppnas i. Samma data, olika axlar. */
export const viewMode = pgEnum("view_mode", ["resource", "person"]);

/**
 * Var ett pass kommer ifrån. "Fyll veckan" skriver bara om sina egna
 * pass, så handpåläggning aldrig försvinner när knappen trycks igen.
 */
export const assignmentSource = pgEnum("assignment_source", ["generated", "manual"]);

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

  /** scrypt-hash med salt och parametrar inbakade. Se lib/password.ts. */
  passwordHash: text("password_hash"),

  /**
   * Användarens identitet i Visma Connect, om vi någon gång får logga in
   * via den. Fältet finns redan nu så kopplingen kan fyllas i efter hand
   * i stället för att behöva backas in i efterhand.
   */
  connectUserId: text("connect_user_id").unique(),

  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),

  /**
   * Spärr efter upprepade felaktiga försök. Räknaren nollställs vid
   * lyckad inloggning; spärren gäller kontot och inte avsändaren,
   * eftersom det är lösenordsgissning mot ett känt konto den ska stoppa.
   */
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Inloggade sessioner.
 *
 * Raden lagrar en hash av sessionstoken, aldrig token själv — läcker
 * databasen går de gamla sessionerna ändå inte att använda.
 */
export const session = pgTable(
  "session",
  {
    /** SHA-256 av kakans värde. */
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUser.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ *
 * Masterdata från TransPA
 *
 * Skrivs av synken. Lokala tillägg (vehicle.displayName,
 * employee.stationPlaceId när TransPA inte bär den) ligger i samma
 * tabell men rörs aldrig av synken — se lib/transpa/sync.ts.
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

/**
 * Ett bolag i TransPA — en tenant.
 *
 * En person tillhör exakt ett bolag och kan aldrig finnas i två.
 * Däremot kan en tavla behöva folk från två bolag: på vissa orter
 * samarbetar två bolag om samma trafik, och då står de på samma tavla
 * utan att för den skull byta anställning. Tavlan låses därför aldrig
 * till ett bolag — kopplingen sitter på personen.
 *
 * Klient-id och hemlighet är gemensamma för alla bolag; det är en och
 * samma Visma-applikation som varje bolag i sin tur ger tillgång. Bara
 * tenant-id skiljer, och namnet finns här för att en meny inte kan visa
 * ett id.
 */
export const transpaTenant = pgTable("transpa_tenant", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Tenant-id hos Visma. */
  tenantId: text("tenant_id").notNull().unique(),
  /** Vad ni kallar bolaget. */
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const employee = pgTable(
  "employee",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transpaId: text("transpa_id").unique(),
    /**
     * Unikt per bolag, inte globalt: två bolag har med stor sannolikhet
     * överlappande anställningsnummer, och en global unik nyckel skulle
     * stoppa synken för det andra bolaget. Se employee_number_uq nedan.
     */
    employeeNumber: text("employee_number"),
    /** Bolaget personen är anställd i. Null för dem som lagts in för hand. */
    transpaTenantId: uuid("transpa_tenant_id").references(() => transpaTenant.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    signature: text("signature"),
    isActive: boolean("is_active").notNull().default(true),

    /**
     * Det stationsortsfiltret i personalväljaren går på. Sätts av synken
     * om TransPA bär uppgiften, annars en gång per person i appen.
     */
    stationPlaceId: uuid("station_place_id").references(() => stationPlace.id),
    trafficAreaId: uuid("traffic_area_id").references(() => trafficArea.id),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("employee_active_idx").on(t.isActive),
    index("employee_station_idx").on(t.stationPlaceId),
    index("employee_tenant_idx").on(t.transpaTenantId),
    unique("employee_number_uq").on(t.transpaTenantId, t.employeeNumber),
  ],
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
 * Arbetsmönster
 *
 * Hur en person jobbar ska komma från TransPA. Tills det går läses det
 * härifrån. En cykel på 1 vecka är ett vanligt veckoschema; Värnamos
 * roterande upplägg med pass 1–4 är en cykel på 4. Ankardatumet avgör
 * var i cykeln en given vecka hamnar.
 * ------------------------------------------------------------------ */

export const workPattern = pgTable(
  "work_pattern",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.id, { onDelete: "cascade" }),
    cycleWeeks: integer("cycle_weeks").notNull().default(1),
    /** Måndagen i den vecka som är cykelvecka 0. */
    anchorDate: date("anchor_date").notNull(),
    /** 0 = söndagen hör till veckan som följer, som Värnamos rullschema. */
    weekStartsOn: integer("week_starts_on").notNull().default(1),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_pattern_employee_idx").on(t.employeeId)],
);

export const workPatternDay = pgTable(
  "work_pattern_day",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workPatternId: uuid("work_pattern_id")
      .notNull()
      .references(() => workPattern.id, { onDelete: "cascade" }),
    /** 0 … cycleWeeks-1 */
    cycleWeek: integer("cycle_week").notNull().default(0),
    /** 0 = söndag … 6 = lördag */
    weekday: integer("weekday").notNull(),
    shift: shift("shift").notNull().default("day"),
  },
  (t) => [unique("work_pattern_day_uq").on(t.workPatternId, t.cycleWeek, t.weekday, t.shift)],
);

/* ------------------------------------------------------------------ *
 * Tavlan
 * ------------------------------------------------------------------ */

export const board = pgTable("board", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  trafficAreaId: uuid("traffic_area_id").references(() => trafficArea.id),
  ownerId: uuid("owner_id").references(() => appUser.id),

  /** 1 = måndag, 0 = söndag. Fjärrbladen inleder veckan med söndagen. */
  weekStartsOn: integer("week_starts_on").notNull().default(1),
  /** Vilka veckodagar som visas, 0=sön … 6=lör. */
  visibleWeekdays: integer("visible_weekdays").array().notNull().default([1, 2, 3, 4, 5]),
  /** Vilka skift tavlan visar. En bil som bara går dagtid visar bara dagraden. */
  visibleShifts: text("visible_shifts").array().notNull().default(["day"]),
  defaultViewMode: viewMode("default_view_mode").notNull().default("resource"),
  /** Delmängd av driver | vehicle | note. */
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

    /** Trafikansvariges eget namn på raden — fritt, oberoende av bilnamnet. */
    label: text("label").notNull(),
    /** Andra kolumnen, typiskt linje eller ort. */
    sublabel: text("sublabel"),
    sortOrder: integer("sort_order").notNull().default(0),
    color: text("color"),

    kind: rowKind("kind").notNull().default("resource"),
    /** Bilen raden står för. Föreslås i cellen och kan bytas per dag. */
    defaultVehicleId: uuid("default_vehicle_id").references(() => vehicle.id),
    /** Sätts bara för person-rader. */
    employeeId: uuid("employee_id").references(() => employee.id),

    /** Inställda linjer avslutas med validTo i stället för att raderas. */
    validFrom: date("valid_from"),
    validTo: date("valid_to"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("board_row_board_idx").on(t.boardId, t.sortOrder)],
);

/**
 * Tavlans bemanning — vilka personer den här trafikansvarige hanterar.
 * Väljs ur hela TransPA-listan, filtrerad på stationsort.
 */
export const boardCrew = pgTable(
  "board_crew",
  {
    boardId: uuid("board_id")
      .notNull()
      .references(() => board.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.employeeId] })],
);

/**
 * Bas-schemat: den stående kopplingen person ↔ bil.
 *
 * Anger *inte* vilka dagar personen kör — det avgörs av personens
 * arbetsdagar. Flera personer får kopplas till samma rad; deras
 * arbetsdagar avgör vem som står där vilken dag.
 */
export const baseSchedule = pgTable(
  "base_schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => board.id, { onDelete: "cascade" }),
    boardRowId: uuid("board_row_id")
      .notNull()
      .references(() => boardRow.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.id, { onDelete: "cascade" }),
    shift: shift("shift").notNull().default("day"),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("base_schedule_board_idx").on(t.boardId),
    index("base_schedule_employee_idx").on(t.employeeId),
  ],
);

/* ------------------------------------------------------------------ *
 * Planeringsdata
 * ------------------------------------------------------------------ */

/**
 * Ett pass: en person på en rad, en dag, ett skift.
 *
 * slot finns för att en tur kan delas av två personer på samma skift.
 */
export const assignment = pgTable(
  "assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    boardRowId: uuid("board_row_id")
      .notNull()
      .references(() => boardRow.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    shift: shift("shift").notNull().default("day"),
    slot: integer("slot").notNull().default(0),

    employeeId: uuid("employee_id").references(() => employee.id),
    vehicleId: uuid("vehicle_id").references(() => vehicle.id),
    note: text("note"),
    source: assignmentSource("source").notNull().default("manual"),

    updatedBy: uuid("updated_by").references(() => appUser.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("assignment_cell_uq").on(t.boardRowId, t.date, t.shift, t.slot),
    /* Konfliktdetektering slår mot de här, tvärs över alla tavlor. */
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

    /** Kvittensen på att frånvaron är inlagd i TransPA. */
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
