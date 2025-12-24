-- SQL Script to clean up duplicate messages from the database
-- This script identifies and removes duplicate messages, keeping only the most recent occurrence

-- First, let's see how many duplicates exist (dry run)
-- Run this query first to see the scope of the problem:

/*
SELECT 
    conversation_id,
    role,
    LEFT(content, 100) as content_preview,
    COUNT(*) as duplicate_count
FROM messages
GROUP BY conversation_id, role, content
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 50;
*/

-- Count total duplicates before cleanup
SELECT 'Before cleanup - duplicate message groups:' as status, COUNT(*) as count
FROM (
    SELECT conversation_id, role, content
    FROM messages
    GROUP BY conversation_id, role, content
    HAVING COUNT(*) > 1
) as duplicates;

-- Delete duplicates, keeping only the most recent message for each unique content
-- This uses a CTE to identify duplicates and delete all but the newest
WITH duplicates AS (
    SELECT 
        id,
        ROW_NUMBER() OVER (
            PARTITION BY conversation_id, role, content 
            ORDER BY created_at DESC
        ) as row_num
    FROM messages
)
DELETE FROM messages
WHERE id IN (
    SELECT id FROM duplicates WHERE row_num > 1
);

-- Count remaining messages after cleanup
SELECT 'After cleanup - total messages remaining:' as status, COUNT(*) as count FROM messages;

-- Verify no duplicates remain
SELECT 'Remaining duplicate groups (should be 0):' as status, COUNT(*) as count
FROM (
    SELECT conversation_id, role, content
    FROM messages
    GROUP BY conversation_id, role, content
    HAVING COUNT(*) > 1
) as duplicates;
