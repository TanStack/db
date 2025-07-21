-- Create publication for Materialize logical replication
-- This allows Materialize to consume changes from PostgreSQL tables

CREATE PUBLICATION mz_publication FOR TABLE todos, config;

-- The following commands should be run in Materialize after it starts up
-- and connects to PostgreSQL. These are included here for reference
-- but need to be executed in Materialize, not PostgreSQL.

/*
-- Run these commands in Materialize (psql -h localhost -p 6875 -d materialize):

-- Create secret for PostgreSQL password (required by Materialize)
CREATE SECRET pgpass AS 'postgres';

-- Create connection to PostgreSQL
CREATE CONNECTION pgconn TO POSTGRES (
  HOST 'postgres',
  PORT 5432,
  USER 'postgres',
  PASSWORD SECRET pgpass,
  DATABASE 'todo_app'
);

-- Create source from PostgreSQL tables
-- This will create a source for the todos table and expose progress tracking
CREATE SOURCE todo_source
  FROM POSTGRES CONNECTION pgconn (PUBLICATION 'mz_publication')
  FOR TABLES (public.todos, public.config)
  EXPOSE PROGRESS AS todo_source_progress;

-- Create materialized views to simplify subscription queries
-- These views mirror the structure of the PostgreSQL tables
CREATE MATERIALIZED VIEW todo_view AS 
  SELECT id, text, completed, created_at, updated_at 
  FROM public.todos;

CREATE MATERIALIZED VIEW config_view AS 
  SELECT id, key, value, created_at, updated_at 
  FROM public.config;
*/