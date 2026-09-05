import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

export const questions = sqliteTable('questions', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  prompt: text('prompt').notNull(),
  options: text('options').notNull(),
  answer: text('answer').notNull(),
  explanation: text('explanation').notNull(),
  category: text('category').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const progress = sqliteTable('progress', {
  userId: text('user_id').notNull(),
  questionId: text('question_id').notNull(),
  selected: text('selected').notNull(),
  correct: integer('correct').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
}, (table) => ({ progressKey: unique().on(table.userId, table.questionId) }));
