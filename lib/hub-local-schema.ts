export const HUB_LOCAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS hub_state(household TEXT PRIMARY KEY REFERENCES households(id),version INTEGER NOT NULL,data TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS hub_child_username ON hub_state(json_extract(data,'$.child.username')) WHERE json_extract(data,'$.child.username') IS NOT NULL;
CREATE TABLE IF NOT EXISTS hub_sessions(token TEXT PRIMARY KEY,household TEXT NOT NULL REFERENCES households(id),child TEXT NOT NULL,credential TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hub_limits(key TEXT PRIMARY KEY,started INTEGER NOT NULL,attempts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hub_uploads(id TEXT PRIMARY KEY,household TEXT NOT NULL,actor TEXT NOT NULL,file TEXT NOT NULL,mime TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hub_awards(record TEXT NOT NULL,day TEXT NOT NULL,household TEXT NOT NULL,title TEXT NOT NULL,active INTEGER NOT NULL,at TEXT NOT NULL,PRIMARY KEY(record,day));
CREATE TRIGGER IF NOT EXISTS hub_chore_insert AFTER INSERT ON routine_checks WHEN EXISTS(SELECT 1 FROM family_records WHERE id=NEW.record AND json_extract(data,'$.type')='chore') BEGIN
 INSERT INTO hub_awards SELECT NEW.record,NEW.day,household,json_extract(data,'$.title'),NEW.checked,NEW.at FROM family_records WHERE id=NEW.record
 ON CONFLICT(record,day) DO UPDATE SET active=excluded.active,at=excluded.at;
END;
CREATE TRIGGER IF NOT EXISTS hub_chore_update AFTER UPDATE ON routine_checks WHEN EXISTS(SELECT 1 FROM hub_awards WHERE record=NEW.record AND day=NEW.day) OR EXISTS(SELECT 1 FROM family_records WHERE id=NEW.record AND json_extract(data,'$.type')='chore') BEGIN
 INSERT INTO hub_awards SELECT NEW.record,NEW.day,household,json_extract(data,'$.title'),NEW.checked,NEW.at FROM family_records WHERE id=NEW.record
 ON CONFLICT(record,day) DO UPDATE SET active=excluded.active,at=excluded.at;
END;
INSERT OR IGNORE INTO hub_awards SELECT c.record,c.day,r.household,json_extract(r.data,'$.title'),c.checked,c.at FROM routine_checks c JOIN family_records r ON r.id=c.record WHERE json_extract(r.data,'$.type')='chore';
`;
