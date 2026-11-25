# Message Search API

Search messages within a conversation.

## Endpoint

```http
GET /api/v1/conversations/:id/messages/search?q=hello&limit=30
Authorization: Bearer ACCESS_TOKEN
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| id | UUID | Conversation identifier |
| q | string | Search query, 1-200 characters |
| limit | integer | Maximum results, 1-50, default 30 |

## Behavior

- Case-insensitive substring matching.
- Leading and trailing whitespace is removed.
- SQL wildcard characters are treated literally.
- Results are sorted newest first.
- Deleted messages and system messages are excluded.
- Only active conversation members can search.
- Existing message serialization is reused.

## Response

The response contains:

- `items`: matching message objects.
- `hasMore`: whether additional matching messages exist.

## HTTP status codes

- 200: Successful search.
- 400: Invalid query parameters.
- 401: Authentication required.
- 404: Conversation unavailable to the requesting user.
- 429: Rate limit exceeded.

## Current limitations

Search pagination and dedicated full-text indexes are not
implemented in this version.

## Security

Search uses the same conversation membership authorization
as message history. Integration tests verify conversation
isolation and unauthorized access.
