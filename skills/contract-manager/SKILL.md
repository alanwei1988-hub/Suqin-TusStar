---
name: contract-manager
description: Identification, metadata extraction, and archiving of contracts and agreements.
---

# Skill: Contract Manager

## Description
This skill handles contract identification, metadata extraction, and archiving.

## Instructions
1.  **Identification**: When a file is received, determine if it's a contract (e.g., "XX协议", "XX合同", "Contract.pdf").
2.  **Extraction**: Extract key metadata:
    *   Contract ID (if any)
    *   Parties (甲方, 乙方)
    *   Amount (金额)
    *   Date (签署日期)
    *   Expiry (有效期)
3.  **Archiving**: Rename and move the file to `storage/contracts/YYYY/MM/`.
    *   Naming format: `YYYYMMDD_甲方_乙方_金额_描述.pdf`
4.  **Confirmation**: Always ask the user to confirm the extracted metadata before moving the file.

## Required Tools
- `bash`: To move files.
- `readFile`: To read file content (if text-based).
- `ocr`: (Future) Mocked for now.
