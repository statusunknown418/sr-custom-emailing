import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const autoEmailing = sqliteTable("auto_emailing", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	originalPostUrl: text("original_post_url").notNull().unique(),
	targetedLeadMagnetId: text("targeted_lead_magnet_id"),
	followUpOneLeadMagnetId: text("follow_up_one_lead_magnet_id"),
	followUpTwoLeadMagnetId: text("follow_up_two_lead_magnet_id"),
	scraped: integer("scraped", { mode: "boolean" }).notNull().default(false),
	postContent: text("post_content"),
	posterName: text("poster_name"),
	email1Subject: text("email1_subject"),
	email1Body: text("email1_body"),
	followUp1Subject: text("follow_up_1_subject"),
	followUp1Body: text("follow_up_1_body"),
	followUp2Subject: text("follow_up_2_subject"),
	followUp2Body: text("follow_up_2_body"),
	createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
	updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
});

export type AutoEmailing = typeof autoEmailing.$inferSelect;
export type NewAutoEmailing = typeof autoEmailing.$inferInsert;
