import { pgTable, text, uuid, integer, real, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').unique().notNull(),
  name: text('name').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
});

export const methodologies = pgTable('methodologies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').unique().notNull(),
  description: text('description').notNull(),
  version: text('version').notNull(),
  phases: jsonb('phases').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  methodology_name: text('methodology_name').notNull(),
  project_id: uuid('project_id').references(() => projects.id),
  topic: text('topic').notNull(),
  status: text('status', { enum: ['active', 'complete'] }).notNull().default('active'),
  current_phase: integer('current_phase').notNull().default(0),
  total_phases: integer('total_phases').notNull(),
  delta: real('delta').notNull().default(0),
  completed_phases: jsonb('completed_phases').notNull().default([]),
  context: jsonb('context').notNull().default({}),
  phase_outputs: jsonb('phase_outputs').notNull().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});

export const phase_events = pgTable('phase_events', {
  id:          uuid('id').primaryKey().defaultRandom(),
  session_id:  text('session_id').references(() => sessions.id).notNull(),
  phase_index: integer('phase_index').notNull(),
  event:       text('event', { enum: ['session_started', 'phase_advanced', 'validation_failed'] }).notNull(),
  payload:     jsonb('payload').notNull().default({}),
  created_at:  timestamp('created_at').defaultNow().notNull(),
});
