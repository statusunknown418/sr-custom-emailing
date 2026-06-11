import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const autoEmailing = sqliteTable("auto_emailing", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	originalPostUrl: text("original_post_url").notNull().unique(),
	// Which flow owns this row: "comment_tracking" (DM bodies authoritative) or
	// "someone_else" (email subject/body fields authoritative). Nullable only for
	// rows that predate the column; set on insert/upsert going forward.
	source: text("source"),
	targetedLeadMagnetId: text("targeted_lead_magnet_id"),
	followUpOneLeadMagnetId: text("follow_up_one_lead_magnet_id"),
	followUpTwoLeadMagnetId: text("follow_up_two_lead_magnet_id"),
	scraped: integer("scraped", { mode: "boolean" }).notNull().default(false),
	postContent: text("post_content"),
	posterName: text("poster_name"),
	posterLeadMagnet: text("poster_lead_magnet"),
	email1Subject: text("email1_subject"),
	email1Body: text("email1_body"),
	followUp1Subject: text("follow_up_1_subject"),
	followUp1Body: text("follow_up_1_body"),
	followUp2Subject: text("follow_up_2_subject"),
	followUp2Body: text("follow_up_2_body"),
	dm1Body: text("dm1_body"),
	dm2Body: text("dm2_body"),
	dm3Body: text("dm3_body"),
	createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
	updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
});

export type AutoEmailing = typeof autoEmailing.$inferSelect;
export type NewAutoEmailing = typeof autoEmailing.$inferInsert;
