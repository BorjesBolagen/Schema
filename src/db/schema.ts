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

/**
 * Vilken sorts bil raden står för.
 *
 * En **linjebil** körs av två bilar som möts på vägen: den ena går upp
 * medan den andra går ner, och nästa natt byter de. Båda står på samma
 * rad samma natt, så riktningen måste synas för att cellen ska gå att
 * läsa.
 *
 * En **bytesbil** vänder halvvägs varje kväll och kör hem igen. Där
 * finns ingen upp och ner att hålla isär, och en riktningspil vore bara
 * brus.
 */
export const vehicleKind = pgEnum("vehicle_kind", ["linjebil", "bytesbil", "annan"]);

/** Riktningen på ett linjepass, läst ur TransPA:s benämning. */
export const direction = pgEnum("direction", ["upp", "ner"]);

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
    /**
     * Yrkesroll från TransPA: driver, other eller garage.
     *
     * Hos Börjes är 281 av 301 chaufförer — de tjugo övriga ska inte
     * skräpa i personallistorna när ett schema läggs. Det är också det
     * enda gruppfält TransPA faktiskt fyller i: `grouping` är tomt för
     * varenda person, och ingetdera bär stationsort.
     */
    professionGroup: text("profession_group"),
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
 * Arbetsdagar
 *
 * Hur en person jobbar kommer från TransPA och ingen annanstans ifrån.
 * De lokala arbetsmönstren som fyllde luckan innan hämtningen fungerade
 * är borttagna — två sanningar om samma sak är en för mycket.
 * ------------------------------------------------------------------ */

/**
 * Pass hämtade från TransPA.
 *
 * Egen tabell av samma skäl som personal och stationsorter har det:
 * tavelvyn ligger bakom en databastidsgräns, och ett nätanrop i
 * renderingsvägen fällde hela sidan när TransPA gick trögt. Passen
 * hämtas i synken och läses härifrån som vilken lokal källa som helst.
 *
 * Ett pass bär inget slutdatum i TransPA — längden ligger i
 * adjustedWorkTimeInMinutes. Vi sparar det som det är i stället för att
 * räkna om det till en sluttid som API:t inte påstår.
 */
export const transpaShift = pgTable(
  "transpa_shift",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Passets id i TransPA. Unikt, så en omsynk uppdaterar i stället för att dubblera. */
    transpaId: text("transpa_id").notNull().unique(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employee.id, { onDelete: "cascade" }),
    /**
     * Datum och skift i svensk lokaltid.
     *
     * Räknas vid hämtningen men är **inte** sanningen — det är en cache
     * och ett grovt index att filtrera veckan på. Sanningen är starts_at
     * och ends_at, och tolkningen görs om vid läsning.
     *
     * Skälet: de här två är härledda värden. Ändras regeln som härleder
     * dem blir varje redan sparad rad tyst fel, och den som tittar på
     * tavlan har ingen aning om att hen ser en gammal tolkning. Det
     * hände: nattpass fortsatte visas som dagpass efter att regeln
     * rättats, ända tills någon råkade hämta om veckan.
     */
    date: date("date").notNull(),
    shift: shift("shift").notNull().default("day"),
    /** Starttiden som TransPA angav den, i UTC. */
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /**
     * Sluttiden ur passets sista partsOfDay, när den finns.
     *
     * Null betyder att TransPA inte uppgav någon, och då får längden
     * uppskatta den — sämre, eftersom arbetstiden räknas utan raster.
     */
    endsAt: timestamp("ends_at", { withTimezone: true }),
    workMinutes: integer("work_minutes"),
    isExtraShift: boolean("is_extra_shift").notNull().default(false),
    name: text("name"),
    /**
     * Upp eller ner, tolkat ur benämningen vid hämtningen.
     *
     * Null betyder att benämningen inte sade något — inte att passet
     * saknar riktning. Skillnaden ska synas i vyn.
     */
    direction: direction("direction"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transpa_shift_lookup_idx").on(t.employeeId, t.date),
    index("transpa_shift_date_idx").on(t.date),
  ],
);

/* ------------------------------------------------------------------ *
 * Vem databasen tillhör
 * ------------------------------------------------------------------ */

/** Namnet uppsättningsfilen kräver att databasen bär. */
export const APP_IDENTITY = "borjes-schema";

/**
 * Märket som säger att den här databasen är Schemas.
 *
 * Uppsättningsfilen klistras in för hand i Supabases SQL-editor, och
 * ingenting i den vyn säger vilket projekt man råkar ha framme. Klistras
 * den i fel projekt skapas tjugo tabeller där de inte hör hemma, och
 * felet upptäcks först när någon undrar varför.
 *
 * Filen vägrar därför köra i en databas som redan har tabeller men
 * saknar det här märket. En tom databas släpps igenom — det är en
 * förstagångsuppsättning — och märket skrivs då.
 */
export const schemaAppIdentity = pgTable("schema_app_identity", {
  app: text("app").primaryKey(),
  installedAt: timestamp("installed_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ *
 * Skrivningar till TransPA
 * ------------------------------------------------------------------ */

export const outboxStatus = pgEnum("outbox_status", ["ok", "failed"]);

/**
 * Varje skrivning till TransPA, med svaret.
 *
 * TransPA-tenanten är Börjes produktionsmiljö. En ändring där påverkar
 * en riktig chaufförs arbetsdag, och den som undrar varför ett pass
 * flyttades ska kunna få veta vem som tryckte, när, och vad som
 * skickades — utan att någon behöver leta i en serverlogg som ändå
 * rullat förbi.
 *
 * Skrivs även när anropet misslyckas. Ett misslyckat försök är också
 * något som hände.
 */
export const transpaOutbox = pgTable(
  "transpa_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Vem som tryckte. */
    userId: uuid("user_id").references(() => appUser.id),
    /** Personen ändringen gällde, som vi känner hen. */
    employeeId: uuid("employee_id").references(() => employee.id, { onDelete: "set null" }),
    /** Passets id hos TransPA. */
    transpaShiftId: text("transpa_shift_id"),
    /** Vad som gjordes, i klartext: "flyttade pass 2026-08-19 → 2026-08-20". */
    summary: text("summary").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    /** Kroppen som skickades, som JSON-text. */
    requestBody: text("request_body"),
    status: outboxStatus("status").notNull(),
    /** HTTP-status, eller null när anropet aldrig nådde fram. */
    responseStatus: integer("response_status"),
    /** Svaret eller felet, avkortat. */
    responseBody: text("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("transpa_outbox_created_idx").on(t.createdAt)],
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

  /**
   * Rullande schema: cykelns längd i veckor och var i den vecka 1 hamnar.
   *
   * Värnamos fyra pass roterar över fyra veckor, och Excelbladet löser
   * det med en tabell som mappar veckonummer till passnummer. Det är en
   * cykel med en förskjutning, och den hör till tavlan eftersom hela
   * tavlan delar samma tabell. Längd 1 betyder ingen rotation.
   */
  cycleLength: integer("cycle_length").notNull().default(1),
  cycleOffset: integer("cycle_offset").notNull().default(0),

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
    /** Linjebil, bytesbil eller annat. Avgör om riktningen visas i cellen. */
    vehicleKind: vehicleKind("vehicle_kind").notNull().default("annan"),
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

    /**
     * När kopplingen gäller. Tomt betyder alltid, inte aldrig.
     *
     * Utan dem säger bas-schemat bara *vilken bil* en person hör till,
     * och det räcker för den som kör samma bil varje dag. Den som kör
     * olika bilar olika dagar, eller olika bilar olika veckor i en
     * rotation, behöver kunna skriva ned just det.
     */
    cycleWeeks: integer("cycle_weeks").array(),
    weekdays: integer("weekdays").array(),

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
