-- Custom SQL migration file, put your code below! --

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for todos table
DROP TRIGGER IF EXISTS update_todos_updated_at ON "todos";
CREATE TRIGGER update_todos_updated_at
BEFORE UPDATE ON "todos"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for config table
DROP TRIGGER IF EXISTS update_config_updated_at ON "config";
CREATE TRIGGER update_config_updated_at
BEFORE UPDATE ON "config"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Insert default config for background color
INSERT INTO "config" ("key", "value")
VALUES ('backgroundColor', '#f5f5f5')
ON CONFLICT ("key") DO NOTHING;