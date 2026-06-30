<?php
ini_set('display_errors', 1);
error_reporting(E_ALL);
require_once __DIR__ . '/config.php';

// ─── CORS & 認証 ───────────────────────────────────────────────────────────────

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Api-Key');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$key = $_SERVER['HTTP_X_API_KEY']
     ?? $_SERVER['HTTP_X_Api_Key']
     ?? getallheaders()['X-Api-Key']
     ?? '';
if ($key !== API_KEY) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

// ─── DB接続 ────────────────────────────────────────────────────────────────────

try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER, DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'DB connection failed']);
    exit;
}

// ─── ルーティング ──────────────────────────────────────────────────────────────

$method   = $_SERVER['REQUEST_METHOD'];
$videoId  = $_GET['video_id'] ?? null;
$body     = json_decode(file_get_contents('php://input'), true) ?? [];

switch ($method) {

    // GET /bookmarks.php?video_id=xxx → 1件取得
    // GET /bookmarks.php?search=xxx&category=xxx&limit=100 → 一覧取得
    case 'GET':
        if ($videoId) {
            getOne($pdo, $videoId);
        } else {
            getList($pdo);
        }
        break;

    // POST /bookmarks.php → upsert（新規 or 更新）
    case 'POST':
        upsertBookmark($pdo, $body);
        break;

    // PATCH /bookmarks.php?video_id=xxx → 部分更新
    case 'PATCH':
        if (!$videoId) { badRequest('video_id required'); break; }
        updateBookmark($pdo, $videoId, $body);
        break;

    // DELETE /bookmarks.php?video_id=xxx → 削除
    case 'DELETE':
        if (!$videoId) { badRequest('video_id required'); break; }
        deleteBookmark($pdo, $videoId);
        break;

    default:
        http_response_code(405);
        echo json_encode(['error' => 'Method not allowed']);
}

// ─── 関数 ─────────────────────────────────────────────────────────────────────

function getOne(PDO $pdo, string $videoId): void {
    $stmt = $pdo->prepare('SELECT * FROM bookmarks WHERE video_id = ?');
    $stmt->execute([$videoId]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        echo json_encode(['exists' => false, 'data' => null]);
        return;
    }
    echo json_encode(['exists' => true, 'data' => decodeRow($row)]);
}

function getList(PDO $pdo): void {
    $search   = $_GET['search']   ?? '';
    $category = $_GET['category'] ?? '';
    $limit    = min((int)($_GET['limit'] ?? 100), 500);

    $where  = [];
    $params = [];

    if ($search !== '') {
        $where[]  = 'MATCH(title, summary, insights) AGAINST(? IN BOOLEAN MODE)';
        $params[] = '+' . implode('* +', explode(' ', trim($search))) . '*';
    }
    if ($category !== '') {
        $where[]  = 'category = ?';
        $params[] = $category;
    }

    $sql = 'SELECT * FROM bookmarks'
         . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
         . ' ORDER BY created_at DESC LIMIT ' . $limit;

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = array_map('decodeRow', $stmt->fetchAll(PDO::FETCH_ASSOC));
    echo json_encode(['ok' => true, 'data' => $rows]);
}

function upsertBookmark(PDO $pdo, array $b): void {
    if (empty($b['video_id']) || empty($b['video_url']) || empty($b['title'])) {
        badRequest('video_id, video_url, title are required');
        return;
    }

    $sql = '
        INSERT INTO bookmarks
            (video_id, video_url, title, channel_name, thumbnail_url, duration,
             tags, user_notes, summary, key_points, important_timestamps,
             category, insights, auto_tags, status)
        VALUES
            (:video_id, :video_url, :title, :channel_name, :thumbnail_url, :duration,
             :tags, :user_notes, :summary, :key_points, :important_timestamps,
             :category, :insights, :auto_tags, :status)
        ON DUPLICATE KEY UPDATE
            video_url            = VALUES(video_url),
            title                = VALUES(title),
            channel_name         = VALUES(channel_name),
            thumbnail_url        = VALUES(thumbnail_url),
            duration             = VALUES(duration),
            tags                 = VALUES(tags),
            user_notes           = VALUES(user_notes),
            summary              = VALUES(summary),
            key_points           = VALUES(key_points),
            important_timestamps = VALUES(important_timestamps),
            category             = VALUES(category),
            insights             = VALUES(insights),
            auto_tags            = VALUES(auto_tags),
            status               = VALUES(status),
            updated_at           = CURRENT_TIMESTAMP
    ';

    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        ':video_id'             => $b['video_id'],
        ':video_url'            => $b['video_url'],
        ':title'                => $b['title'],
        ':channel_name'         => $b['channel_name']         ?? null,
        ':thumbnail_url'        => $b['thumbnail_url']        ?? null,
        ':duration'             => $b['duration']             ?? null,
        ':tags'                 => json_encode($b['tags']     ?? [], JSON_UNESCAPED_UNICODE),
        ':user_notes'           => $b['user_notes']           ?? '',
        ':summary'              => $b['summary']              ?? null,
        ':key_points'           => json_encode($b['key_points']            ?? [], JSON_UNESCAPED_UNICODE),
        ':important_timestamps' => json_encode($b['important_timestamps']  ?? [], JSON_UNESCAPED_UNICODE),
        ':category'             => $b['category']             ?? null,
        ':insights'             => $b['insights']             ?? null,
        ':auto_tags'            => json_encode($b['auto_tags'] ?? [], JSON_UNESCAPED_UNICODE),
        ':status'               => $b['status']               ?? 'pending',
    ]);

    echo json_encode(['ok' => true]);
}

function updateBookmark(PDO $pdo, string $videoId, array $updates): void {
    if (empty($updates)) { badRequest('no fields to update'); return; }

    $jsonFields = ['tags', 'key_points', 'important_timestamps', 'auto_tags'];
    $allowed    = ['video_url','title','channel_name','thumbnail_url','duration',
                   'tags','user_notes','summary','key_points','important_timestamps',
                   'category','insights','auto_tags','status'];

    $sets   = [];
    $params = [];
    foreach ($updates as $col => $val) {
        if (!in_array($col, $allowed, true)) continue;
        $sets[]        = "`$col` = ?";
        $params[]      = in_array($col, $jsonFields, true) ? json_encode($val, JSON_UNESCAPED_UNICODE) : $val;
    }

    if (empty($sets)) { badRequest('no valid fields'); return; }

    $sets[]   = 'updated_at = CURRENT_TIMESTAMP';
    $params[] = $videoId;

    $stmt = $pdo->prepare('UPDATE bookmarks SET ' . implode(', ', $sets) . ' WHERE video_id = ?');
    $stmt->execute($params);
    echo json_encode(['ok' => true]);
}

function deleteBookmark(PDO $pdo, string $videoId): void {
    $stmt = $pdo->prepare('DELETE FROM bookmarks WHERE video_id = ?');
    $stmt->execute([$videoId]);
    echo json_encode(['ok' => true]);
}

// JSONカラムをPHPの配列にデコードして返す
function decodeRow(array $row): array {
    foreach (['tags', 'key_points', 'important_timestamps', 'auto_tags'] as $col) {
        if (isset($row[$col]) && is_string($row[$col])) {
            $row[$col] = json_decode($row[$col], true) ?? [];
        }
    }
    return $row;
}

function badRequest(string $msg): void {
    http_response_code(400);
    echo json_encode(['error' => $msg]);
}
