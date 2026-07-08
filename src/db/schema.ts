import { pgTable, serial, varchar, timestamp, integer, text } from "drizzle-orm/pg-core";

// Статусы проверки Steam ID
// AVAILABLE - вероятно можно использовать
// TAKEN - занят другим пользователем  
// RESERVED_OR_UNKNOWN - зарезервирован Steam или невозможно определить
export const steamIdChecks = pgTable("steam_id_checks", {
  id: serial("id").primaryKey(),
  vanityUrl: varchar("vanity_url", { length: 255 }).notNull(),
  status: varchar("status", { length: 30 }).notNull().default("RESERVED_OR_UNKNOWN"),
  steamId64: varchar("steam_id_64", { length: 30 }),  // ID владельца если занят
  reason: text("reason"),  // Пояснение статуса
  checkedAt: timestamp("checked_at").defaultNow().notNull(),
});

export const searchSessions = pgTable("search_sessions", {
  id: serial("id").primaryKey(),
  minLength: integer("min_length").notNull().default(4),
  maxLength: integer("max_length").notNull().default(6),
  charset: varchar("charset", { length: 50 }).notNull().default("alphanumeric"),
  totalChecked: integer("total_checked").notNull().default(0),
  totalAvailable: integer("total_available").notNull().default(0),
  status: varchar("status", { length: 20 }).notNull().default("running"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  pattern: text("pattern"),
});
