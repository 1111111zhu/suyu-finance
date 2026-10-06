ALTER TABLE rd.projects
  DROP CONSTRAINT projects_status_check,
  ADD CONSTRAINT projects_status_check
    CHECK (status IN ('init', 'active', 'paused', 'stopped', 'completed'));

UPDATE rd.projects
SET status = CASE
  WHEN raw_status IN ('暂停', '暂缓') THEN 'paused'
  WHEN raw_status IN ('停止', '关闭') THEN 'stopped'
  ELSE status
END,
updated_at = CURRENT_TIMESTAMP
WHERE status = 'init' AND raw_status IN ('暂停', '暂缓', '停止', '关闭');
