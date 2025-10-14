# Code Suggestion Feature Implementation Plan

A comprehensive guide to building an AI-powered code suggestion feature for Bitbucket Pull Requests in JavaScript/Node.js.

---

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Step-by-Step Implementation](#step-by-step-implementation)
4. [API Reference](#api-reference)
5. [Example Code](#example-code)
6. [Best Practices](#best-practices)

---

## Overview

### What This Feature Does
1. Fetches PR diff from Bitbucket
2. Analyzes code changes using AI
3. Generates inline code suggestions
4. Posts suggestions as inline comments on the PR

### Tech Stack (JavaScript)
- **Runtime**: Node.js
- **HTTP Client**: axios or node-fetch
- **AI Provider**: OpenAI API, Anthropic Claude, or similar
- **Bitbucket API**: REST API v2.0

---

## Architecture

```
┌─────────────────┐
│  Trigger Event  │  (Webhook, CLI, Manual)
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│  1. Fetch PR Diff       │
│  GET /pullrequests/{id}/diff
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  2. Parse Diff          │
│  - Split by files       │
│  - Extract hunks        │
│  - Get line numbers     │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  3. Fetch File Contents │
│  (Optional but recommended)
│  GET /src/{commit}/{path}
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  4. Prepare AI Prompt   │
│  - Format diff          │
│  - Add instructions     │
│  - Include context      │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  5. Call AI API         │
│  - Send prompt          │
│  - Get suggestions JSON │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  6. Parse AI Response   │
│  - Extract suggestions  │
│  - Validate line numbers│
│  - Filter by score      │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  7. Post to Bitbucket   │
│  POST /pullrequests/{id}/comments
│  (Inline comments)      │
└─────────────────────────┘
```

---

## Step-by-Step Implementation

### Step 1: Fetch PR Diff from Bitbucket

**Endpoint**: `GET /2.0/repositories/{workspace}/{repo}/pullrequests/{pr_id}/diff`

**Code Example**:
```javascript
const axios = require('axios');

async function fetchPRDiff(workspace, repo, prId, token) {
  const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/pullrequests/${prId}/diff`;

  const response = await axios.get(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/plain'
    }
  });

  return response.data; // Returns unified diff string
}
```

**Example Response**:
```diff
diff --git a/src/app.js b/src/app.js
index 1234567..abcdefg 100644
--- a/src/app.js
+++ b/src/app.js
@@ -10,7 +10,7 @@ function calculateTotal(items) {
   let total = 0;
   for (let i = 0; i < items.length; i++) {
-    total += items[i].price;
+    total += items[i].price * items[i].quantity;
   }
   return total;
 }
```

---

### Step 2: Parse the Diff

**Goal**: Extract file changes, line numbers, and hunks

**Code Example**:
```javascript
function parseDiff(diffText) {
  const files = [];
  const fileSections = diffText.split('diff --git ').filter(s => s.trim());

  for (const section of fileSections) {
    const lines = section.split('\n');

    // Extract filename from first line: a/path/file.js b/path/file.js
    const fileMatch = lines[0].match(/a\/(.+?)\s+b\/(.+)/);
    if (!fileMatch) continue;

    const filename = fileMatch[2]; // Use the 'b/' version (new file)

    // Find the start of actual diff (after ---, +++)
    let diffStartIndex = lines.findIndex(line => line.startsWith('@@'));
    if (diffStartIndex === -1) continue;

    // Extract all hunks
    const hunks = [];
    let currentHunk = null;

    for (let i = diffStartIndex; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('@@')) {
        // Parse hunk header: @@ -10,7 +10,7 @@ function name
        const hunkMatch = line.match(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
        if (hunkMatch) {
          if (currentHunk) hunks.push(currentHunk);

          currentHunk = {
            oldStart: parseInt(hunkMatch[1]),
            oldLines: parseInt(hunkMatch[2]),
            newStart: parseInt(hunkMatch[3]),
            newLines: parseInt(hunkMatch[4]),
            changes: []
          };
        }
      } else if (currentHunk) {
        currentHunk.changes.push(line);
      }
    }

    if (currentHunk) hunks.push(currentHunk);

    files.push({
      filename,
      hunks,
      patch: lines.slice(diffStartIndex).join('\n')
    });
  }

  return files;
}
```

**Example Output**:
```javascript
[
  {
    filename: 'src/app.js',
    hunks: [
      {
        oldStart: 10,
        oldLines: 7,
        newStart: 10,
        newLines: 7,
        changes: [
          '   let total = 0;',
          '   for (let i = 0; i < items.length; i++) {',
          '-    total += items[i].price;',
          '+    total += items[i].price * items[i].quantity;',
          '   }',
          '   return total;',
          ' }'
        ]
      }
    ],
    patch: '@@ -10,7 +10,7 @@...'
  }
]
```

---

### Step 3: Fetch Full File Contents (Optional)

**Endpoint**: `GET /2.0/repositories/{workspace}/{repo}/src/{commit_hash}/{file_path}`

**Code Example**:
```javascript
async function fetchFileContent(workspace, repo, commitHash, filePath, token) {
  const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/src/${commitHash}/${filePath}`;

  const response = await axios.get(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'text/plain'
    }
  });

  return response.data;
}

// Get PR commits to get source and destination commit hashes
async function getPRCommits(workspace, repo, prId, token) {
  const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/pullrequests/${prId}`;

  const response = await axios.get(url, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  return {
    sourceCommit: response.data.source.commit.hash,
    destinationCommit: response.data.destination.commit.hash
  };
}
```

---

### Step 4: Prepare AI Prompt

**Goal**: Create a structured prompt for the AI to generate suggestions

**Code Example**:
```javascript
function buildAIPrompt(parsedFiles, prTitle, prDescription) {
  const systemPrompt = `You are an expert code reviewer. Analyze the provided code changes and suggest improvements.

For each suggestion, provide:
1. relevant_file: The file path
2. relevant_lines_start: Starting line number (absolute position in new file)
3. relevant_lines_end: Ending line number (absolute position in new file)
4. suggestion_content: Brief description of the suggestion
5. improved_code: The improved code snippet
6. existing_code: The current code snippet
7. label: Category (e.g., "bug risk", "performance", "best practice", "security")
8. score: Importance from 1-10 (10 being critical)

Focus on:
- Security vulnerabilities
- Performance issues
- Code quality and best practices
- Potential bugs
- Maintainability improvements

Return ONLY a JSON array of suggestions. Do not include any other text.`;

  const userPrompt = `# Pull Request: ${prTitle}

${prDescription ? `## Description\n${prDescription}\n\n` : ''}

## Code Changes

${parsedFiles.map(file => `
### File: ${file.filename}

\`\`\`diff
${file.patch}
\`\`\`
`).join('\n')}

Please analyze these changes and provide code suggestions in JSON format.`;

  return { systemPrompt, userPrompt };
}
```

**Expected JSON Response Format**:
```json
[
  {
    "relevant_file": "src/app.js",
    "relevant_lines_start": 13,
    "relevant_lines_end": 13,
    "suggestion_content": "Use const instead of let for variables that are not reassigned",
    "improved_code": "const total = 0;",
    "existing_code": "let total = 0;",
    "label": "best practice",
    "score": 6
  },
  {
    "relevant_file": "src/app.js",
    "relevant_lines_start": 13,
    "relevant_lines_end": 13,
    "suggestion_content": "Add null check for items array to prevent runtime errors",
    "improved_code": "if (!items || !Array.isArray(items)) return 0;\nconst total = 0;",
    "existing_code": "const total = 0;",
    "label": "bug risk",
    "score": 8
  }
]
```

---

### Step 5: Call AI API

**Using OpenAI**:
```javascript
const OpenAI = require('openai');

async function getAISuggestions(systemPrompt, userPrompt, apiKey) {
  const openai = new OpenAI({ apiKey });

  const response = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    response_format: { type: 'json_object' }, // Force JSON response
    temperature: 0.3 // Lower temperature for more consistent output
  });

  const content = response.choices[0].message.content;
  return JSON.parse(content);
}
```

**Using Anthropic Claude**:
```javascript
const Anthropic = require('@anthropic-ai/sdk');

async function getAISuggestions(systemPrompt, userPrompt, apiKey) {
  const anthropic = new Anthropic({ apiKey });

  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.3
  });

  const content = response.content[0].text;
  // Extract JSON from markdown code blocks if present
  const jsonMatch = content.match(/```json\n([\s\S]+?)\n```/) ||
                    content.match(/\[[\s\S]+\]/);

  return JSON.parse(jsonMatch ? jsonMatch[1] || jsonMatch[0] : content);
}
```

---

### Step 6: Parse and Validate AI Response

**Code Example**:
```javascript
function validateAndFilterSuggestions(suggestions, scoreThreshold = 6) {
  const validSuggestions = [];

  for (const suggestion of suggestions) {
    // Validate required fields
    if (!suggestion.relevant_file ||
        !suggestion.relevant_lines_start ||
        !suggestion.suggestion_content) {
      console.warn('Skipping invalid suggestion:', suggestion);
      continue;
    }

    // Parse line numbers
    const lineStart = parseInt(suggestion.relevant_lines_start);
    const lineEnd = parseInt(suggestion.relevant_lines_end || lineStart);

    // Validate line numbers
    if (isNaN(lineStart) || isNaN(lineEnd) || lineStart < 1 || lineEnd < lineStart) {
      console.warn('Invalid line numbers:', suggestion);
      continue;
    }

    // Filter by score
    const score = parseInt(suggestion.score || 0);
    if (score < scoreThreshold) {
      console.log(`Filtering out low-score suggestion (${score}):`, suggestion.suggestion_content);
      continue;
    }

    validSuggestions.push({
      ...suggestion,
      relevant_lines_start: lineStart,
      relevant_lines_end: lineEnd,
      score
    });
  }

  return validSuggestions;
}
```

---

### Step 7: Post Inline Comments to Bitbucket

**Endpoint**: `POST /2.0/repositories/{workspace}/{repo}/pullrequests/{pr_id}/comments`

**Code Example**:
```javascript
async function postInlineComment(workspace, repo, prId, suggestion, token) {
  const url = `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/pullrequests/${prId}/comments`;

  // Create diff format for the suggestion
  let body = `**Suggestion:** ${suggestion.suggestion_content} [${suggestion.label}`;
  if (suggestion.score) {
    body += `, importance: ${suggestion.score}`;
  }
  body += ']\n\n';

  // Add code diff if available
  if (suggestion.existing_code && suggestion.improved_code) {
    const diff = createDiff(suggestion.existing_code, suggestion.improved_code);
    body += '```diff\n' + diff + '\n```';
  }

  const payload = {
    content: {
      raw: body
    },
    inline: {
      to: suggestion.relevant_lines_start, // Bitbucket only supports single line
      path: suggestion.relevant_file
    }
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log(`✓ Posted suggestion to ${suggestion.relevant_file}:${suggestion.relevant_lines_start}`);
    return response.data;
  } catch (error) {
    console.error(`✗ Failed to post suggestion:`, error.response?.data || error.message);
    throw error;
  }
}

// Helper function to create unified diff
function createDiff(oldCode, newCode) {
  const oldLines = oldCode.split('\n');
  const newLines = newCode.split('\n');

  const diff = [];
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    if (oldLines[i] !== undefined && oldLines[i] !== newLines[i]) {
      diff.push(`-${oldLines[i]}`);
    }
    if (newLines[i] !== undefined && oldLines[i] !== newLines[i]) {
      diff.push(`+${newLines[i]}`);
    }
  }

  return diff.join('\n');
}

// Post all suggestions
async function postAllSuggestions(workspace, repo, prId, suggestions, token) {
  const results = [];

  for (const suggestion of suggestions) {
    try {
      const result = await postInlineComment(workspace, repo, prId, suggestion, token);
      results.push({ success: true, suggestion, result });

      // Rate limiting: wait 500ms between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      results.push({ success: false, suggestion, error: error.message });
    }
  }

  return results;
}
```

---

### Step 8: Main Orchestration Function

**Complete Pipeline**:
```javascript
async function generateCodeSuggestions(workspace, repo, prId, config) {
  const { bitbucketToken, openaiApiKey, scoreThreshold = 6 } = config;

  console.log(`\n🔍 Analyzing PR #${prId}...\n`);

  // 1. Fetch PR diff
  console.log('📥 Fetching PR diff...');
  const diffText = await fetchPRDiff(workspace, repo, prId, bitbucketToken);

  // 2. Parse diff
  console.log('📝 Parsing diff...');
  const parsedFiles = parseDiff(diffText);
  console.log(`   Found ${parsedFiles.length} changed file(s)`);

  if (parsedFiles.length === 0) {
    console.log('⚠️  No files to analyze');
    return;
  }

  // 3. Get PR metadata (optional)
  console.log('📋 Fetching PR details...');
  const prData = await axios.get(
    `https://api.bitbucket.org/2.0/repositories/${workspace}/${repo}/pullrequests/${prId}`,
    { headers: { Authorization: `Bearer ${bitbucketToken}` } }
  );
  const prTitle = prData.data.title;
  const prDescription = prData.data.description || '';

  // 4. Build AI prompt
  console.log('🤖 Preparing AI prompt...');
  const { systemPrompt, userPrompt } = buildAIPrompt(parsedFiles, prTitle, prDescription);

  // 5. Get AI suggestions
  console.log('🧠 Calling AI API...');
  const rawSuggestions = await getAISuggestions(systemPrompt, userPrompt, openaiApiKey);

  // Handle both array and object responses
  const suggestions = Array.isArray(rawSuggestions)
    ? rawSuggestions
    : (rawSuggestions.suggestions || rawSuggestions.code_suggestions || []);

  console.log(`   Received ${suggestions.length} suggestion(s)`);

  // 6. Validate and filter
  console.log('✅ Validating suggestions...');
  const validSuggestions = validateAndFilterSuggestions(suggestions, scoreThreshold);
  console.log(`   ${validSuggestions.length} suggestion(s) passed validation`);

  if (validSuggestions.length === 0) {
    console.log('✨ No suggestions to post');
    return;
  }

  // 7. Post to Bitbucket
  console.log('\n💬 Posting suggestions to Bitbucket...\n');
  const results = await postAllSuggestions(workspace, repo, prId, validSuggestions, bitbucketToken);

  // Summary
  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  console.log('\n📊 Summary:');
  console.log(`   ✓ Successfully posted: ${successCount}`);
  if (failCount > 0) {
    console.log(`   ✗ Failed to post: ${failCount}`);
  }
  console.log('\n✨ Done!\n');

  return results;
}
```

---

## API Reference

### Bitbucket API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/2.0/repositories/{workspace}/{repo}/pullrequests/{pr_id}` | GET | Get PR details |
| `/2.0/repositories/{workspace}/{repo}/pullrequests/{pr_id}/diff` | GET | Get PR diff |
| `/2.0/repositories/{workspace}/{repo}/pullrequests/{pr_id}/diffstat` | GET | Get file change stats |
| `/2.0/repositories/{workspace}/{repo}/pullrequests/{pr_id}/comments` | GET | Get PR comments |
| `/2.0/repositories/{workspace}/{repo}/pullrequests/{pr_id}/comments` | POST | Create inline comment |
| `/2.0/repositories/{workspace}/{repo}/src/{commit}/{path}` | GET | Get file content |

### Authentication

**Bearer Token** (Recommended):
```javascript
headers: {
  'Authorization': 'Bearer {access_token}'
}
```

**OAuth 2.0**:
```javascript
// Get access token
const tokenResponse = await axios.post('https://bitbucket.org/site/oauth2/access_token',
  'grant_type=client_credentials', {
    auth: {
      username: clientId,
      password: clientSecret
    }
  }
);

const accessToken = tokenResponse.data.access_token;
```

---

## Example Code

### Complete Working Example

```javascript
// index.js
require('dotenv').config();
const axios = require('axios');
const OpenAI = require('openai');

// ... (include all functions from above)

// Main execution
async function main() {
  const config = {
    bitbucketToken: process.env.BITBUCKET_TOKEN,
    openaiApiKey: process.env.OPENAI_API_KEY,
    scoreThreshold: 6
  };

  const workspace = 'your-workspace';
  const repo = 'your-repo';
  const prId = 123;

  await generateCodeSuggestions(workspace, repo, prId, config);
}

main().catch(console.error);
```

### Environment Variables (.env)

```bash
BITBUCKET_TOKEN=your_bitbucket_access_token
OPENAI_API_KEY=your_openai_api_key

# Or use Anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key
```

### Package.json

```json
{
  "name": "pr-code-suggestions",
  "version": "1.0.0",
  "description": "AI-powered code suggestions for Bitbucket PRs",
  "main": "index.js",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "axios": "^1.6.0",
    "openai": "^4.20.0",
    "@anthropic-ai/sdk": "^0.20.0",
    "dotenv": "^16.3.0"
  }
}
```

---

## Best Practices

### 1. **Error Handling**

```javascript
async function safeApiCall(fn, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;

      const delay = Math.pow(2, i) * 1000; // Exponential backoff
      console.log(`Retry ${i + 1}/${retries} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

### 2. **Rate Limiting**

```javascript
class RateLimiter {
  constructor(maxRequests, perMilliseconds) {
    this.maxRequests = maxRequests;
    this.perMilliseconds = perMilliseconds;
    this.requests = [];
  }

  async throttle() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.perMilliseconds);

    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.perMilliseconds - (now - oldestRequest);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.requests.push(Date.now());
  }
}

const limiter = new RateLimiter(10, 60000); // 10 requests per minute
await limiter.throttle();
```

### 3. **Cost Optimization**

- **Token limits**: Chunk large diffs to stay within AI model token limits
- **File filtering**: Ignore generated files, lock files, and binary files
- **Caching**: Cache AI responses for identical code segments
- **Batch processing**: Group similar changes together

```javascript
function shouldAnalyzeFile(filename) {
  const ignoredExtensions = ['.lock', '.min.js', '.bundle.js'];
  const ignoredPaths = ['node_modules/', 'dist/', 'build/'];

  return !ignoredExtensions.some(ext => filename.endsWith(ext)) &&
         !ignoredPaths.some(path => filename.includes(path));
}
```

### 4. **Suggestion Quality**

```javascript
// Add context about the codebase
const systemPrompt = `You are reviewing code for a ${techStack} application.

Code standards:
- Use TypeScript strict mode
- Follow ESLint rules: ${eslintConfig}
- Test coverage required for all business logic
- Security: No hardcoded secrets, validate all inputs

...`;
```

### 5. **Webhook Integration**

```javascript
const express = require('express');
const app = express();

app.post('/webhook/bitbucket', express.json(), async (req, res) => {
  const event = req.headers['x-event-key'];

  if (event === 'pullrequest:created' || event === 'pullrequest:updated') {
    const { pullrequest, repository } = req.body;

    // Respond immediately
    res.status(200).send('Processing...');

    // Process asynchronously
    generateCodeSuggestions(
      repository.workspace.slug,
      repository.name,
      pullrequest.id,
      config
    ).catch(console.error);
  } else {
    res.status(200).send('Ignored');
  }
});

app.listen(3000);
```

---

## Testing Strategy

### Unit Tests
```javascript
const assert = require('assert');

describe('parseDiff', () => {
  it('should parse single file diff', () => {
    const diff = `diff --git a/test.js b/test.js
@@ -1,1 +1,1 @@
-let x = 1;
+const x = 1;`;

    const result = parseDiff(diff);
    assert.equal(result.length, 1);
    assert.equal(result[0].filename, 'test.js');
  });
});
```

### Integration Tests
```javascript
// Test with real Bitbucket API (use test repository)
describe('Bitbucket Integration', () => {
  it('should fetch and parse real PR diff', async () => {
    const diff = await fetchPRDiff('test-workspace', 'test-repo', 1, token);
    const parsed = parseDiff(diff);
    assert(parsed.length > 0);
  });
});
```

---

## Deployment Options

### 1. **Serverless (AWS Lambda)**
```javascript
exports.handler = async (event) => {
  const { workspace, repo, prId } = JSON.parse(event.body);

  const results = await generateCodeSuggestions(workspace, repo, prId, {
    bitbucketToken: process.env.BITBUCKET_TOKEN,
    openaiApiKey: process.env.OPENAI_API_KEY
  });

  return {
    statusCode: 200,
    body: JSON.stringify(results)
  };
};
```

### 2. **Docker Container**
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
CMD ["node", "index.js"]
```

### 3. **GitHub Actions / Bitbucket Pipelines**
```yaml
# bitbucket-pipelines.yml
pipelines:
  pull-requests:
    '**':
      - step:
          name: Code Suggestions
          script:
            - npm install
            - node generate-suggestions.js $BITBUCKET_REPO_OWNER $BITBUCKET_REPO_SLUG $BITBUCKET_PR_ID
```

---

## Monitoring & Logging

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Track metrics
logger.info('suggestion_posted', {
  pr_id: prId,
  file: suggestion.relevant_file,
  score: suggestion.score,
  label: suggestion.label
});
```

---

## Troubleshooting

### Common Issues

**1. Line numbers don't match**
- Ensure you're using absolute line numbers from the new file
- Account for context lines in diff hunks

**2. AI returns invalid JSON**
- Add JSON schema validation
- Use structured output modes (OpenAI) or XML tags (Claude)

**3. Rate limits hit**
- Implement exponential backoff
- Use request queuing
- Consider upgrading API tiers

**4. Suggestions not appearing**
- Check Bitbucket API permissions (PR read/write)
- Verify line numbers are within file bounds
- Ensure file paths exactly match PR diff

---

## Next Steps

1. ✅ Implement basic pipeline
2. ✅ Add error handling and retries
3. ✅ Integrate with CI/CD
4. 🔄 Add suggestion filtering by file type
5. 🔄 Implement suggestion ranking
6. 🔄 Add user feedback collection
7. 🔄 Train custom models on feedback

---

## Resources

- [Bitbucket REST API Documentation](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pullrequests/)
- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference)
- [Anthropic Claude API Documentation](https://docs.anthropic.com/claude/reference)
- [Unified Diff Format](https://www.gnu.org/software/diffutils/manual/html_node/Detailed-Unified.html)

---

**Created**: 2025-01-XX
**Last Updated**: 2025-01-XX
**Version**: 1.0
