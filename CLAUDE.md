# wishmotors-tg-analyzer — Claude Instructions

## Project Overview

Georgian-language Telegram bot for auto parts sales tracking (wishmotors).

## Tech Stack

- Python 3.x
- python-telegram-bot
- SQLite / SQLAlchemy
- Deployed on Railway

## How Claude Should Work With the User

### Autonomous Execution

Act autonomously without asking for permission for ANY of the following:
- Reading files, exploring directories, searching code
- Editing or creating files (1–10+ files)
- Installing or removing packages/dependencies
- Running tests, linters, formatters, type checkers
- Making commits and pushing to GitHub
- Running external API calls or shell commands
- Refactoring, architectural changes, configuration changes
- Multi-file changes of any size

**The ONE exception — always ask before:**
- Deleting files, directories, database records, or any data permanently

Report what was done after the fact. Never ask "should I go ahead?" for anything except deletion.
