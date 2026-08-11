-- pg_cron 通过 net.http_post 调用公网 EF URL 无法解析域名
-- 禁用该任务，天气刷新改由前端打开时触发（缓存过期自动静默刷新）
SELECT cron.unschedule('weather-tianjin-refresh');