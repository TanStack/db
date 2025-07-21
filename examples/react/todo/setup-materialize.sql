-- Setup script for Materialize
-- Run this in Materialize: psql -h localhost -p 6875 -d materialize -f setup-materialize.sql

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