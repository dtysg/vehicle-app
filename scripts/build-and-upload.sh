#!/bin/bash
# ============================================================
#  vehicle-app 一键本地构建 + 上传 Supabase + 写版本记录
#  用法：bash scripts/build-and-upload.sh
# ============================================================
set -e

# ── 读取 .env ──────────────────────────────────────────────
source "$(dirname "$0")/../.env" 2>/dev/null || true

SUPABASE_URL="${EXPO_PUBLIC_SUPABASE_URL}"
SUPABASE_ANON_KEY="${EXPO_PUBLIC_SUPABASE_ANON_KEY}"

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "❌ 请确认 .env 中有 EXPO_PUBLIC_SUPABASE_URL 和 EXPO_PUBLIC_SUPABASE_ANON_KEY"
  exit 1
fi

# ── 读取当前版本号 ─────────────────────────────────────────
VERSION=$(node -e "const a=require('./app.json'); console.log(a.expo.version)")
VERSION_CODE=$(node -e "const v='${VERSION}'.split('.').pop(); console.log(parseInt(v)+1)")
VERSION_NAME="1.0.${VERSION_CODE}"

echo "📦 当前版本: ${VERSION} → 新版本: ${VERSION_NAME} (code: ${VERSION_CODE})"

# ── Step 1: Gradle 构建 ────────────────────────────────────
echo ""
echo "🔨 Step 1/3 开始 Gradle Release 构建..."
cd android
if [ "$(uname)" == "Darwin" ] || [ "$(uname)" == "Linux" ]; then
  ./gradlew assembleRelease --no-daemon
else
  cmd /c gradlew.bat assembleRelease --no-daemon
fi
cd ..

APK_PATH="android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK_PATH" ]; then
  echo "❌ APK 未找到: $APK_PATH"
  exit 1
fi
echo "✅ APK 构建成功: $APK_PATH ($(du -sh $APK_PATH | cut -f1))"

# ── Step 2: 上传到 Supabase Storage ───────────────────────
echo ""
echo "☁️  Step 2/3 上传到 Supabase Storage..."

STORAGE_PATH="apk/vehicle-app-${VERSION_NAME}.apk"
UPLOAD_URL="${SUPABASE_URL}/storage/v1/object/apk-releases/${STORAGE_PATH}"

UPLOAD_RESP=$(curl -s -w "\n%{http_code}" -X POST "$UPLOAD_URL" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/vnd.android.package-archive" \
  --data-binary @"$APK_PATH")

HTTP_CODE=$(echo "$UPLOAD_RESP" | tail -1)
RESP_BODY=$(echo "$UPLOAD_RESP" | head -1)

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  echo "❌ 上传失败 (HTTP $HTTP_CODE): $RESP_BODY"
  echo "   请检查 Supabase Storage Bucket 'apk-releases' 是否存在且为公开"
  exit 1
fi

APK_PUBLIC_URL="${SUPABASE_URL}/storage/v1/object/public/apk-releases/${STORAGE_PATH}"
echo "✅ 上传成功: $APK_PUBLIC_URL"

# ── Step 3: 写入 app_versions 表 ──────────────────────────
echo ""
echo "📝 Step 3/3 写入版本记录到 app_versions..."

RELEASE_NOTES="• $(git log -1 --pretty=%s 2>/dev/null || echo '本地构建')"

INSERT_RESP=$(curl -s -w "\n%{http_code}" -X POST "${SUPABASE_URL}/rest/v1/app_versions" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d "{
    \"version_name\": \"${VERSION_NAME}\",
    \"version_code\": ${VERSION_CODE},
    \"apk_url\": \"${APK_PUBLIC_URL}\",
    \"release_notes\": \"${RELEASE_NOTES}\",
    \"is_force\": false
  }")

INSERT_CODE=$(echo "$INSERT_RESP" | tail -1)
INSERT_BODY=$(echo "$INSERT_RESP" | head -1)

if [ "$INSERT_CODE" != "200" ] && [ "$INSERT_CODE" != "201" ]; then
  echo "❌ 写入版本记录失败 (HTTP $INSERT_CODE): $INSERT_BODY"
  exit 1
fi

echo ""
echo "============================================"
echo "🎉 全部完成！"
echo "   版本名: ${VERSION_NAME}"
echo "   版本号: ${VERSION_CODE}"
echo "   APK URL: ${APK_PUBLIC_URL}"
echo "   App 内更新弹窗将在下次启动后自动显示"
echo "============================================"
