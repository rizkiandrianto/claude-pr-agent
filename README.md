# 🤖 Claude Code Agent

```
     ██████╗██╗      █████╗ ██╗   ██╗██████╗ ███████╗
    ██╔════╝██║     ██╔══██╗██║   ██║██╔══██╗██╔════╝
    ██║     ██║     ███████║██║   ██║██║  ██║█████╗  
    ██║     ██║     ██╔══██║██║   ██║██║  ██║██╔══╝  
    ╚██████╗███████╗██║  ██║╚██████╔╝██████╔╝███████╗
     ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚══════╝
    
          🚀 Bitbucket Webhook Integration
```

## ✨ Description

**Claude Code Agent** is an intelligent Bitbucket webhook service that supercharges your pull requests with AI-powered insights. Built with Claude AI, this service automatically analyzes your code changes and provides:

- **🔍 Smart PR Descriptions** - AI-generated summaries appended to pull request descriptions
- **📝 Code Reviews** - Comprehensive feedback posted as PR comments  
- **💡 Inline Suggestions** - Contextual improvements directly on specific code lines
- **⚡ Real-time Processing** - Instant analysis triggered by Bitbucket webhook events

Transform your development workflow with intelligent code analysis that helps teams ship better code faster.

## 🚀 Getting Started

### Prerequisites
- Docker & Docker Compose
- Bitbucket workspace access
- Claude API credentials

### Quick Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd claude-code-agent
   ```

2. **Configure & Launch**
   ```bash
   docker compose run --rm webhook sh -lc 'claude --version && claude login'
   ```

3. **Set Environment Variables**
   Configure your `.env` file with:
   - `BB_CLIENT_ID` - Bitbucket OAuth client ID
   - `BB_CLIENT_SECRET` - Bitbucket OAuth client secret  
   - `WEBHOOK_SECRET` - Webhook signature verification secret

4. **Start the Service**
   ```bash
   docker compose up -d
   ```

Your Claude Code Agent will be running on `http://localhost:8080` 🎉

## 🛠️ Features

| Feature | Description | Environment Variable |
|---------|-------------|---------------------|
| 🤖 **AI Descriptions** | Auto-generate PR summaries | `ENABLE_DESCRIBE=1` |
| 📋 **Code Reviews** | Comprehensive PR analysis | `ENABLE_REVIEW=1` |  
| 💬 **Inline Comments** | Line-specific suggestions | `ENABLE_INLINE=1` |
| ⚙️ **Query Control** | Runtime feature toggling | `?describe=false&review=false&inline=false` |

## 📡 Webhook Endpoint

Configure your Bitbucket webhook to point to:
```
POST /webhook/bitbucket
```

The service automatically processes `pullrequest:*` events and applies the configured AI analysis features.

## 🔧 Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port |
| `MAX_INLINE_COMMENTS` | `10` | Maximum inline comments per PR |
| `MAX_DESC_APPEND_CHARS` | `2500` | Character limit for description append |

## 🏗️ Architecture

Built with:
- **Node.js + TypeScript** - Modern JavaScript runtime
- **Express.js** - Fast, minimalist web framework
- **Claude AI** - Advanced code analysis capabilities
- **Docker** - Containerized deployment
- **Bitbucket API** - Seamless repository integration

---

<div align="center">

**Made with ❤️ and Claude AI**

*Empowering developers with intelligent code insights*

</div>