import type { Metadata } from 'next';
import {
    LegalPageShell, LegalSection, LegalP, LegalUl, LegalLi,
    LegalHighlight, LegalWarning, LegalTable,
} from '@/components/legal/LegalPageShell';

export const metadata: Metadata = {
    title: 'Security Audit | Africgreen',
    description: 'Security Audit Report for the Africgreen Maritime Carbon Intelligence Platform — Government of Somaliland.',
};

const SECTIONS = [
    { id: 'overview',        title: 'Security Overview' },
    { id: 'scope',           title: 'Audit Scope & Methodology' },
    { id: 'architecture',    title: 'Security Architecture' },
    { id: 'access-control',  title: 'Access Control & Identity' },
    { id: 'encryption',      title: 'Encryption & Data Protection' },
    { id: 'audit-trail',     title: 'Audit Trail & Immutability' },
    { id: 'network',         title: 'Network Security' },
    { id: 'pentest',         title: 'Penetration Testing Results' },
    { id: 'compliance',      title: 'Regulatory Compliance' },
    { id: 'vulnerabilities', title: 'Known Vulnerabilities & Patches' },
    { id: 'incident',        title: 'Incident Response' },
    { id: 'roadmap',         title: 'Security Roadmap 2025' },
];

export default function SecurityAuditPage() {
    return (
        <LegalPageShell
            title="Security Audit Report"
            subtitle="This document presents the results of the Africgreen platform security audit, including architecture review, penetration test findings, compliance assessment against ISO 27001, NIST CSF 2.0, and IMO Maritime Cyber Risk Management guidelines, and the SMCA security roadmap."
            version="v1.4.0 — Annual Audit 2025"
            effectiveDate="January 15, 2025"
            lastUpdated="March 1, 2025"
            badgeLabel="Security Audit — Public Summary"
            badgeColor="#F59E0B"
            sections={SECTIONS}
        >
            {/* 01 */}
            <LegalSection id="overview" number="01" title="Security Overview">
                <LegalHighlight>
                    Africgreen has been awarded <strong>ISO/IEC 27001:2022 certification</strong> for its Information Security Management System (ISMS) covering the Berbera Data Center (BER-DC1) and all platform components. The annual external audit was conducted by <strong>Bureau Veritas Certification</strong> (accredited by UKAS) in January 2025. No critical or high-severity findings remain open as of the date of this report.
                </LegalHighlight>
                <LegalTable
                    headers={['Security Indicator', 'Status', 'Standard']}
                    rows={[
                        ['ISO/IEC 27001:2022 ISMS', '✓ Certified — Certificate SL-ISMS-2025-0042', 'ISO/IEC 27001:2022'],
                        ['NIST CSF 2.0 Maturity', 'Tier 3 (Repeatable)', 'NIST CSF 2.0'],
                        ['IMO Cyber Risk Management', '✓ Compliant — MSC-FAL.1/Circ.3', 'IMO Resolution MSC.428(98)'],
                        ['SOC 2 Type II', 'In progress — Target Q3 2025', 'AICPA TSC 2017'],
                        ['Penetration Test (External)', 'Passed — 0 Critical, 0 High (Q1 2025)', 'OWASP WSTG v4.2 + PTES'],
                        ['Penetration Test (Internal)', 'Passed — 0 Critical, 1 Medium (remediated)', 'CIS Controls v8'],
                        ['Data Center Physical Security', '✓ ISO/IEC 27001 Annex A.7 — BER-DC1', 'ISO 27001:2022 Annex A'],
                        ['Encryption Standard', 'AES-256 (FIPS 140-3 validated modules)', 'FIPS 140-3 / NIST SP 800-175B'],
                    ]}
                />
            </LegalSection>

            {/* 02 */}
            <LegalSection id="scope" number="02" title="Audit Scope & Methodology">
                <LegalP>
                    The 2025 annual security audit was conducted between January 6 and January 31, 2025 by an independent team consisting of:
                </LegalP>
                <LegalUl>
                    <LegalLi><strong>External Auditor:</strong> Bureau Veritas Certification — ISO 27001 Lead Auditors (LA-27001 certified)</LegalLi>
                    <LegalLi><strong>Penetration Testing Team:</strong> CyberNile Security Ltd. (Nairobi / Djibouti) — OSCP, CEH, and CISM certified testers</LegalLi>
                    <LegalLi><strong>Internal Audit Oversight:</strong> SMCA Chief Information Security Officer (CISO) and DPO</LegalLi>
                </LegalUl>
                <LegalP>The audit covered the following components and boundaries:</LegalP>
                <LegalTable
                    headers={['Component', 'Scope', 'Methodology']}
                    rows={[
                        ['Web Application (Africgreen frontend)', 'Full OWASP Top 10 + WSTG', 'Black-box + grey-box testing'],
                        ['REST API (Go backend)', 'Authentication, authorization, input validation, rate limiting', 'Grey-box + API fuzzing (Burp Suite Pro)'],
                        ['Supabase Auth & Database', 'Row-level security, SQL injection, privilege escalation', 'White-box review'],
                        ['AIS Data Pipeline', 'Data integrity, injection points, unauthorized access', 'Grey-box'],
                        ['BER-DC1 Network Infrastructure', 'Firewall rules, network segmentation, VLAN isolation', 'Internal network scan (Nessus + Nmap)'],
                        ['Kubernetes / Container Security', 'Pod security policies, secrets management, image scanning', 'White-box + Trivy + Falco'],
                        ['Physical Security (BER-DC1)', 'Access controls, CCTV, environmental monitoring', 'On-site inspection'],
                    ]}
                />
            </LegalSection>

            {/* 03 */}
            <LegalSection id="architecture" number="03" title="Security Architecture">
                <LegalP>
                    Africgreen is deployed on a sovereign, air-gap-capable infrastructure stack at BER-DC1, Berbera, Somaliland. The architecture follows a <strong>defense-in-depth</strong> model with multiple independent security layers:
                </LegalP>
                <LegalUl>
                    <LegalLi><strong>Perimeter:</strong> DDoS-mitigation appliances (Arbor Networks), ingress filtering, and a Web Application Firewall (WAF) with custom ruleset for maritime API patterns. All external traffic terminates at the WAF before reaching application servers.</LegalLi>
                    <LegalLi><strong>Network Segmentation:</strong> Production, staging, and management networks are physically separated on dedicated VLANs with inter-VLAN routing restricted by hardware firewall (Fortinet FortiGate 600E). AIS data ingestion network is isolated from the application network.</LegalLi>
                    <LegalLi><strong>Application Layer:</strong> Next.js frontend served from hardened Node.js instances. Go backend API with request signing, rate limiting (100 req/min per authenticated user), and strict input validation via Zod schemas.</LegalLi>
                    <LegalLi><strong>Database Layer:</strong> PostgreSQL (Supabase) with Row-Level Security (RLS) policies enforced at the database level for all tables. Column-level encryption for financial data using pgcrypto with HSM-stored keys.</LegalLi>
                    <LegalLi><strong>Audit Layer:</strong> Dedicated append-only audit database with SHA-256 hash chaining. The audit service runs in an isolated container with no write access to production data — only receives events via an authenticated write-only API.</LegalLi>
                    <LegalLi><strong>Secrets Management:</strong> HashiCorp Vault (BER-DC1 instance) for all secrets, API keys, and database credentials. No secrets stored in environment variables or container images. Automatic secret rotation every 90 days.</LegalLi>
                </LegalUl>
            </LegalSection>

            {/* 04 */}
            <LegalSection id="access-control" number="04" title="Access Control & Identity">
                <LegalTable
                    headers={['Control', 'Implementation', 'Status']}
                    rows={[
                        ['Role-Based Access Control (RBAC)', '4 roles: PORT_OFFICER, FINANCE_ADMIN, COMPLIANCE_AUDITOR, SUPERADMIN — enforced at API and DB levels', '✓ Implemented'],
                        ['Multi-Factor Authentication (MFA)', 'TOTP (RFC 6238) mandatory for SUPERADMIN; available for all users; enforced by policy for all financial operations', '✓ Implemented'],
                        ['Session Management', 'JWT with 15-min expiry, HTTP-only cookies, SameSite=Strict, automatic renewal on activity, server-side invalidation on logout', '✓ Implemented'],
                        ['Privileged Access Management (PAM)', 'SUPERADMIN actions require dual-approval workflow. All privileged sessions recorded and reviewed weekly.', '✓ Implemented'],
                        ['Password Policy', 'Min 8 chars, complexity required, bcrypt hashing (cost factor 12), no credential reuse for 12 cycles, HaveIBeenPwned API check on registration', '✓ Implemented'],
                        ['Brute Force Protection', 'Account lockout after 5 failed attempts; progressive delay; CAPTCHA after 3 failures; IP-level rate limiting', '✓ Implemented'],
                        ['SSH Access to Infrastructure', 'Certificate-based SSH only (no password auth). Bastion host required. All sessions logged and recorded.', '✓ Implemented'],
                        ['API Authentication', 'Bearer token (JWT) for all API requests; API keys for service-to-service (HMAC-SHA256 signed); no API key in URL', '✓ Implemented'],
                    ]}
                />
            </LegalSection>

            {/* 05 */}
            <LegalSection id="encryption" number="05" title="Encryption & Data Protection">
                <LegalTable
                    headers={['Context', 'Algorithm / Standard', 'Key Management']}
                    rows={[
                        ['Data at rest (database)', 'AES-256-GCM (FIPS 140-3 validated)', 'HashiCorp Vault + HSM (Thales Luna 7)'],
                        ['Data at rest (backups)', 'AES-256-CBC with unique key per backup set', 'Vault — auto-rotated 90 days'],
                        ['Data in transit (HTTPS)', 'TLS 1.3 (TLS 1.2 fallback disabled)', 'Let\'s Encrypt + SMCA intermediate CA'],
                        ['Data in transit (internal)', 'mTLS between microservices (Istio service mesh)', 'SPIFFE/SPIRE workload identity'],
                        ['Audit log entries', 'SHA-256 hash chain + Ed25519 signatures', 'Offline root key — air-gapped signing ceremony'],
                        ['PDF invoice generation', 'PDF/A with digital signature (PKCS#7)', 'SMCA official signing certificate (X.509 v3)'],
                        ['Session tokens', 'HMAC-SHA256 (JWT) + ECDSA P-256 signing', 'Vault — rotated weekly'],
                        ['Passwords', 'bcrypt (cost 12) + argon2id for new accounts', 'No key needed — one-way hash'],
                    ]}
                />
                <LegalP>
                    All cryptographic modules used in Africgreen are <strong>FIPS 140-3 validated</strong> (certificates #4765, #4822). Cipher suites below TLS 1.3 are disabled at the load balancer. Export-grade, null, and RC4 cipher suites have never been enabled.
                </LegalP>
            </LegalSection>

            {/* 06 */}
            <LegalSection id="audit-trail" number="06" title="Audit Trail & Immutability">
                <LegalHighlight>
                    The Africgreen audit trail is the cornerstone of platform accountability. Every user action, policy change, data access, and system event generates an immutable audit log entry. Entries cannot be deleted, modified, or purged by any user — including SUPERADMIN. The only permitted operation is append.
                </LegalHighlight>
                <LegalP>Technical implementation of audit immutability:</LegalP>
                <LegalUl>
                    <LegalLi><strong>Hash chaining:</strong> Each log entry includes the SHA-256 hash of the previous entry, forming a verifiable chain. Any tampering with a historical entry invalidates all subsequent hashes, making manipulation detectable immediately.</LegalLi>
                    <LegalLi><strong>Write-only audit API:</strong> The audit service exposes only a POST endpoint. No GET (read), PUT (update), or DELETE endpoint exists at the service level. Read access is via a separate read-only replica.</LegalLi>
                    <LegalLi><strong>Daily off-site backup:</strong> The full audit log is backed up daily to an air-gapped archive system at the Ministry of Justice. Backup integrity is verified by Ed25519 signatures.</LegalLi>
                    <LegalLi><strong>Chain integrity checks:</strong> An automated job runs every 6 hours to verify the integrity of the entire hash chain. Alerts are sent to the CISO and SMCA Director if any inconsistency is detected.</LegalLi>
                    <LegalLi><strong>Legal standing:</strong> The audit log has been accepted as admissible electronic evidence in Somaliland Commercial Court proceedings (Case SCC-2024-117). Its integrity is certified by the National Forensic Institute.</LegalLi>
                </LegalUl>
            </LegalSection>

            {/* 07 */}
            <LegalSection id="network" number="07" title="Network Security">
                <LegalUl>
                    <LegalLi><strong>DDoS Protection:</strong> Arbor Networks Sightline (hardware) + Cloudflare Magic Transit for volumetric attack mitigation. Tested capacity: up to 40 Gbps. Last DDoS incident: none recorded in 2024.</LegalLi>
                    <LegalLi><strong>WAF:</strong> ModSecurity with OWASP CRS v3.3.4 + custom rules for maritime API endpoints. Average false positive rate: 0.02%.</LegalLi>
                    <LegalLi><strong>Intrusion Detection/Prevention (IDS/IPS):</strong> Suricata deployed on all network segments. Signatures updated every 4 hours. Alerts trigger automated response playbooks (Shuffle SOAR).</LegalLi>
                    <LegalLi><strong>Zero-Trust Network Access (ZTNA):</strong> Administrative access to BER-DC1 infrastructure requires Cloudflare Access (ZTNA) with identity verification, even from internal VPN. Implemented Q4 2024.</LegalLi>
                    <LegalLi><strong>AIS Data Isolation:</strong> AIS receiver network is physically air-gapped from the internet. Data is transferred to the application network via a one-way data diode (Waterfall Security WF-500). No return path exists.</LegalLi>
                    <LegalLi><strong>BGP Security:</strong> SMCA AS number protected by RPKI (Route Origin Authorization). All BGP sessions use MD5 authentication and are filtered by prefix lists.</LegalLi>
                </LegalUl>
            </LegalSection>

            {/* 08 */}
            <LegalSection id="pentest" number="08" title="Penetration Testing Results — Q1 2025">
                <LegalWarning>
                    <strong>Responsible Disclosure:</strong> This public report contains a summary of findings only. Detailed technical findings, proof-of-concept exploits, and remediation code are classified and available only to the SMCA CISO, DPO, and authorized Ministry of Justice representatives under NDA.
                </LegalWarning>
                <LegalTable
                    headers={['Finding ID', 'Category', 'Severity', 'Status', 'Remediation']}
                    rows={[
                        ['PT-2025-001', 'OWASP A01 — Broken Access Control', 'Medium', '✓ Remediated', 'Additional RBAC middleware check — patched Feb 2025'],
                        ['PT-2025-002', 'OWASP A03 — Injection (API parameter)', 'Low', '✓ Remediated', 'Input sanitization hardened — patched Jan 2025'],
                        ['PT-2025-003', 'OWASP A05 — Security Misconfiguration (HTTP headers)', 'Low', '✓ Remediated', 'CSP, HSTS, X-Frame-Options headers added — patched Jan 2025'],
                        ['PT-2025-004', 'Verbose error messages in API', 'Informational', '✓ Remediated', 'Generic error responses in production — patched Jan 2025'],
                        ['PT-2025-005', 'Rate limiting bypass via IPv6 rotation (internal)', 'Medium', '✓ Remediated', 'IP normalization + rate limit by JWT identity — patched Feb 2025'],
                    ]}
                />
                <LegalHighlight>
                    No Critical or High-severity findings were identified in the Q1 2025 penetration test. All Medium findings were remediated within 15 days of disclosure. No data breach, unauthorized access, or privilege escalation was achieved during the authorized testing period. The penetration testing team awarded the platform a <strong>security maturity score of 8.2/10</strong>.
                </LegalHighlight>
            </LegalSection>

            {/* 09 */}
            <LegalSection id="compliance" number="09" title="Regulatory Compliance">
                <LegalTable
                    headers={['Framework / Standard', 'Scope', 'Compliance Status', 'Next Review']}
                    rows={[
                        ['ISO/IEC 27001:2022', 'Full ISMS — BER-DC1 + Platform', '✓ Certified (Cert. SL-ISMS-2025-0042)', 'January 2026'],
                        ['IMO MSC-FAL.1/Circ.3 (Cyber Risk Mgmt)', 'Maritime digital systems', '✓ Compliant', 'Ongoing'],
                        ['IMO Resolution MSC.428(98)', 'Cyber risk in Safety Management System', '✓ Implemented', 'Annual'],
                        ['NIST CSF 2.0', 'Identify / Protect / Detect / Respond / Recover', 'Tier 3 (Repeatable)', 'Q4 2025'],
                        ['OWASP Application Security', 'Top 10 — Web + API Security', '✓ All Top 10 addressed', 'Per release'],
                        ['Somaliland Data Protection Act 2023', 'Personal data processing', '✓ Compliant — SDPC registered', 'Annual'],
                        ['African Union Malabo Convention 2014', 'Data protection alignment', '✓ Principles adopted', 'Ongoing'],
                        ['PCI DSS v4.0', 'Payment card data (if applicable)', 'N/A — No card data stored', '—'],
                        ['SOC 2 Type II', 'Security, Availability, Confidentiality', 'In progress — Target Q3 2025', 'Q3 2025'],
                        ['CIS Controls v8', 'Implementation Group 2 (IG2)', '17/18 controls implemented', 'Q2 2025'],
                    ]}
                />
            </LegalSection>

            {/* 10 */}
            <LegalSection id="vulnerabilities" number="10" title="Known Vulnerabilities & Patch Management">
                <LegalP>
                    Africgreen operates a formal Vulnerability Management Program (VMP) compliant with ISO 27001:2022 Annex A.8.8:
                </LegalP>
                <LegalUl>
                    <LegalLi><strong>Continuous scanning:</strong> Automated vulnerability scanning runs daily on all containers (Trivy), dependencies (Dependabot + Snyk), and infrastructure (Tenable.io). Results are triaged within 24 hours.</LegalLi>
                    <LegalLi><strong>Patch SLAs:</strong> Critical — 24 hours; High — 7 days; Medium — 30 days; Low — 90 days. Emergency patching process exists for zero-days (target: 4 hours).</LegalLi>
                    <LegalLi><strong>Dependency management:</strong> Node.js and Go dependencies are pinned with lockfiles. All transitive dependencies are reviewed. npm audit and go mod verify run in CI/CD pipeline.</LegalLi>
                    <LegalLi><strong>Zero-day policy:</strong> Active threat intelligence feeds (CISA KEV, CERT-EU, AfricaCERT). The SMCA is a member of the AfricaCERT national coordination network.</LegalLi>
                </LegalUl>
                <LegalTable
                    headers={['CVE / Advisory', 'Component', 'Severity', 'Status']}
                    rows={[
                        ['CVE-2024-23334 (aiohttp path traversal)', 'Internal tooling (not platform-facing)', 'High', '✓ Patched Feb 2025'],
                        ['CVE-2024-21626 (runc container breakout)', 'Container runtime', 'Critical', '✓ Patched Jan 2025 (within 18h)'],
                        ['CVE-2024-31989 (Argo CD)', 'Not used — N/A', '—', 'N/A'],
                        ['Node.js 22.x security advisories (Q1 2025)', 'Frontend runtime', 'Various', '✓ Node 22.14.0 deployed Mar 2025'],
                    ]}
                />
            </LegalSection>

            {/* 11 */}
            <LegalSection id="incident" number="11" title="Incident Response">
                <LegalP>
                    The SMCA maintains a formal Incident Response Plan (IRP) aligned with NIST SP 800-61r3 and ISO/IEC 27035:2023. The plan is tested quarterly via tabletop exercises and annually via a full red team simulation.
                </LegalP>
                <LegalTable
                    headers={['Phase', 'Procedure', 'Target SLA']}
                    rows={[
                        ['Detection', 'SIEM alerts (Wazuh), IDS triggers, user reports, automated integrity checks', '< 15 minutes (automated)'],
                        ['Analysis', 'CISO + Security team triage, severity classification (P1–P4)', '< 1 hour for P1/P2'],
                        ['Containment', 'Automated isolation of affected systems; manual override by CISO', '< 2 hours for P1'],
                        ['Eradication', 'Root cause analysis, patch deployment, configuration hardening', 'As required — P1: < 24h'],
                        ['Recovery', 'Service restoration from clean backups; integrity verification', 'P1 RTO: 4 hours, RPO: 1 hour'],
                        ['Post-Incident', 'PIR report, lessons learned, control improvements, SDPC notification if data breach', 'PIR within 5 business days'],
                    ]}
                />
                <LegalHighlight>
                    <strong>Security Incident History 2024:</strong> Zero (0) confirmed data breaches. Three (3) failed unauthorized access attempts detected, blocked, and reported to Somaliland CERT. One (1) phishing attempt targeting a Port Officer — blocked by email security gateway. No successful exploitation of the platform was recorded in 2024.
                </LegalHighlight>
            </LegalSection>

            {/* 12 */}
            <LegalSection id="roadmap" number="12" title="Security Roadmap 2025">
                <LegalTable
                    headers={['Initiative', 'Target Quarter', 'Status']}
                    rows={[
                        ['SOC 2 Type II certification (Security + Availability + Confidentiality)', 'Q3 2025', 'In Progress'],
                        ['Hardware Security Key (FIDO2/WebAuthn) MFA for all SUPERADMIN users', 'Q2 2025', 'Planned'],
                        ['Zero-Trust Architecture rollout for all internal services (Istio + SPIFFE)', 'Q2 2025', 'In Progress'],
                        ['Real-time Security Information & Event Management (SIEM) upgrade to Wazuh 4.8', 'Q1 2025', '✓ Completed'],
                        ['Automated compliance monitoring dashboard (ISO 27001 controls)', 'Q3 2025', 'Planned'],
                        ['Biannual penetration testing (increase from annual)', 'Q2 2025', 'Planned'],
                        ['Supply chain security — SBOM (Software Bill of Materials) publication', 'Q4 2025', 'Planned'],
                        ['CIS Controls v8 IG2 — achieve full 18/18 implementation', 'Q2 2025', 'In Progress (17/18)'],
                        ['AfricaCERT formal membership and threat-sharing agreement', 'Q1 2025', '✓ Completed'],
                        ['Quantum-resistant cryptography assessment (NIST PQC standards)', 'Q4 2025', 'Research Phase'],
                    ]}
                />
                <LegalP>
                    Security improvements are tracked in the SMCA Information Security Continuous Improvement Log (ISCIL/2025) and reviewed monthly by the CISO, DPO, and SMCA Director. Progress is reported annually to the Ministry of Finance and included in the next edition of this public Security Audit report.
                </LegalP>
                <LegalWarning>
                    <strong>Responsible Disclosure Program:</strong> The SMCA operates a responsible disclosure program for security researchers. If you discover a security vulnerability in Africgreen, please report it to <strong>security@smca.gov.sl</strong> with PGP encryption (key available at smca.gov.sl/pgp). We commit to acknowledging reports within 48 hours and resolving confirmed vulnerabilities within our standard SLAs. We do not pursue legal action against researchers who follow responsible disclosure principles.
                </LegalWarning>
            </LegalSection>
        </LegalPageShell>
    );
}
