# PartQuill Azure migration and startup-credit milestone plan

Last updated: 2026-08-29

## Non-negotiable goals

1. Azure becomes the only production home for PartQuill after parity testing.
2. Remove the PartQuill Render service and database after the Azure completion audit and explicit deletion confirmation.
3. eBay writes remain disabled until separately approved.
4. Maintain at least five genuine Azure workloads, each with at least USD 1 in spend for approximately 60 continuous days, to pursue the Microsoft for Startups USD 25,000 milestone.
5. Keep the PartQuill resource-group budget at USD 100/month with alerts at 50%, 80%, and 100%.
6. Do not create waste purely to inflate workload count. Each qualifying workload must have a documented PartQuill purpose.

## Target qualifying workloads

| Workload | PartQuill purpose | Qualification status |
|---|---|---|
| Azure Database for PostgreSQL | Primary application and catalog database | Active; above USD 1 confirmed |
| Azure AI Search | Indexed retrieval for the exact parts catalog | Provisioned; above USD 1 confirmed; integration pending |
| Azure Container Registry | Stores versioned PartQuill application images | Active; verify monthly spend above USD 1 |
| Azure Container Apps | Runs the PartQuill web application and workers | Deployment in progress; verify monthly spend above USD 1 |
| Azure Monitor / Log Analytics | Health, deployment, error, and audit telemetry | Active; verify monthly spend above USD 1 |

Supporting services such as Storage, Key Vault, DNS, Document Intelligence, and networking remain useful but must not be counted toward the milestone until Azure Cost Management confirms at least USD 1 of sustained workload spend.

## Weekly milestone check

- Confirm five workloads each show at least USD 1 in Azure Cost Management.
- Record the first date on which all five simultaneously qualify.
- Treat any workload dropping below USD 1 as a possible reset of the 60-day clock.
- Confirm total monthly PartQuill spend remains within the USD 100 budget.
- Verify every paid workload has a real PartQuill function.
- Preserve screenshots or exported cost data as evidence.
- Check Founders Hub for milestone progress or requests.
- Do not delete or downgrade a qualifying workload without checking milestone impact.

## Migration gates

- Azure application health and readiness pass.
- Render PostgreSQL schema and application data copied and checksum-verified in Azure PostgreSQL.
- Exact 894,592-record certified GM source imported, with 894,593 catalog rows available including the preserved seed row.
- Every source page ID from 100001 through 235000 classified as an uploaded Azure Blob image or an independently verified unavailable source page.
- Every certified catalog page reference covered by the uploaded image manifest.
- Persistent files, secrets references, and configuration copied.
- Record counts and known probes pass, including GM part 10110988 -> page 138445.
- partquill.com switched only after parity certification.
- PartQuill Render web service and PostgreSQL instance deleted after final approval; unrelated IronVault Render resources remain untouched.
