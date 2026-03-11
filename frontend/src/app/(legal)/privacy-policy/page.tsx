import type { Metadata } from 'next';
import {
    LegalPageShell, LegalSection, LegalP, LegalUl, LegalLi,
    LegalHighlight, LegalWarning, LegalTable,
} from '@/components/legal/LegalPageShell';

export const metadata: Metadata = {
    title: 'Privacy Policy | Africgreen',
    description: 'Privacy Policy of the Africgreen Maritime Carbon Intelligence Platform — Government of Somaliland.',
};

const SECTIONS = [
    { id: 'preamble',      title: 'Preamble & Legal Basis' },
    { id: 'controller',    title: 'Data Controller' },
    { id: 'data-collected',title: 'Data Collected' },
    { id: 'purpose',       title: 'Purpose of Processing' },
    { id: 'legal-basis',   title: 'Legal Basis for Processing' },
    { id: 'retention',     title: 'Data Retention' },
    { id: 'sharing',       title: 'Data Sharing & Transfers' },
    { id: 'rights',        title: 'Your Rights' },
    { id: 'ais-data',      title: 'AIS & Maritime Surveillance Data' },
    { id: 'security',      title: 'Data Security' },
    { id: 'cookies',       title: 'Cookies & Session Management' },
    { id: 'contact',       title: 'Contact & Complaints' },
];

export default function PrivacyPolicyPage() {
    return (
        <LegalPageShell
            title="Privacy Policy"
            subtitle="This document explains how the Government of Somaliland, through the Africgreen platform, collects, processes, stores, and protects personal data in connection with maritime carbon tax administration and sovereign environmental monitoring."
            version="v2.1.0"
            effectiveDate="January 1, 2025"
            lastUpdated="March 1, 2025"
            badgeLabel="Privacy & Data Protection"
            badgeColor="#38BDF8"
            sections={SECTIONS}
        >
            {/* 01 */}
            <LegalSection id="preamble" number="01" title="Preamble & Legal Basis">
                <LegalP>
                    The <strong>Africgreen Maritime Carbon Intelligence Platform</strong> is operated by the Ministry of Finance and Economic Development of the Republic of Somaliland (hereinafter &quot;the Ministry&quot;) on behalf of the <strong>Somaliland Maritime Carbon Authority (SMCA)</strong>. This platform collects and processes personal and organizational data as part of its statutory mandate to administer maritime carbon taxes, enforce environmental compliance, and generate sovereign revenue from the Gulf of Aden Exclusive Economic Zone (EEZ).
                </LegalP>
                <LegalHighlight>
                    This Privacy Policy is enacted pursuant to the <strong>Somaliland Data Protection Act 2023</strong>, the principles of the <strong>African Union Convention on Cyber Security and Personal Data Protection (Malabo Convention, 2014)</strong>, the <strong>IMO Maritime Cyber Risk Management Guidelines (MSC-FAL.1/Circ.3)</strong>, and the <strong>Maritime Carbon Act 2024</strong>. Where applicable, we also align our practices with the <strong>EU General Data Protection Regulation (GDPR 2016/679)</strong> for data subjects residing in or connected to European jurisdictions.
                </LegalHighlight>
                <LegalP>
                    All processing activities are subject to oversight by the <strong>Somaliland Data Protection Commissioner (SDPC)</strong> and are recorded in the official national data processing register. This policy applies to all users of Africgreen, including Port Authority officers, Finance Administrators, Shipping Agents, and Armateurs.
                </LegalP>
            </LegalSection>

            {/* 02 */}
            <LegalSection id="controller" number="02" title="Data Controller">
                <LegalTable
                    headers={['Field', 'Information']}
                    rows={[
                        ['Data Controller', 'Ministry of Finance & Economic Development — Republic of Somaliland'],
                        ['Operating Entity', 'Somaliland Maritime Carbon Authority (SMCA)'],
                        ['Platform', 'Africgreen — Sovereign Carbon Intelligence Platform'],
                        ['Registered Address', 'Ministry of Finance, Hargeisa, Republic of Somaliland'],
                        ['Data Protection Officer', 'dpo@smca.gov.sl'],
                        ['Technical Operations', 'Berbera Data Center (BER-DC1) — Node BER-01'],
                        ['Encryption Standard', 'AES-256 at rest · TLS 1.3 in transit'],
                    ]}
                />
            </LegalSection>

            {/* 03 */}
            <LegalSection id="data-collected" number="03" title="Data Collected">
                <LegalP>We collect data across three categories of data subjects:</LegalP>

                <div className="flex flex-col gap-4">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-[#00D97E] mb-2">A. Platform Users (Port Officers, Administrators)</p>
                        <LegalUl>
                            <LegalLi>Full name, official email address, government employee identifier</LegalLi>
                            <LegalLi>Functional role and clearance level within the platform</LegalLi>
                            <LegalLi>IP address, device fingerprint, browser user-agent, session timestamps</LegalLi>
                            <LegalLi>Immutable audit trail of all actions performed on the platform</LegalLi>
                            <LegalLi>Multi-factor authentication (MFA) status and last login metadata</LegalLi>
                            <LegalLi>Preferred language, timezone, and notification preferences</LegalLi>
                        </LegalUl>
                    </div>
                    <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-[#38BDF8] mb-2">B. Shipping Agents & Armateurs</p>
                        <LegalUl>
                            <LegalLi>Company name, IMO operator registration number, country of incorporation</LegalLi>
                            <LegalLi>Contact person name, professional email address, phone number</LegalLi>
                            <LegalLi>Fleet composition: vessel names, IMO numbers, MMSI codes, flag states</LegalLi>
                            <LegalLi>Financial data: invoice history, payment records, outstanding tax liabilities</LegalLi>
                            <LegalLi>Port call history, cargo declarations, and pro-forma invoice records</LegalLi>
                        </LegalUl>
                    </div>
                    <div>
                        <p className="text-xs font-bold uppercase tracking-widest text-[#F59E0B] mb-2">C. Maritime & Environmental Data</p>
                        <LegalUl>
                            <LegalLi>Automatic Identification System (AIS) position data: latitude, longitude, heading, speed, last-seen timestamp</LegalLi>
                            <LegalLi>Vessel technical specifications: gross tonnage, engine power, design speed</LegalLi>
                            <LegalLi>Estimated CO₂ emission calculations based on IMO MARPOL Annex VI methodology</LegalLi>
                            <LegalLi>Carbon credit retirement records and offset certificates</LegalLi>
                            <LegalLi>Port entry/exit logs and EEZ transit records</LegalLi>
                        </LegalUl>
                    </div>
                </div>
            </LegalSection>

            {/* 04 */}
            <LegalSection id="purpose" number="04" title="Purpose of Processing">
                <LegalTable
                    headers={['Purpose', 'Legal Basis', 'Data Category']}
                    rows={[
                        ['Maritime carbon tax assessment and invoice generation', 'Legal obligation — Maritime Carbon Act 2024, Art. 12', 'Vessel data, AIS, tonnage'],
                        ['EEZ compliance monitoring and enforcement', 'Public interest — SMCA Mandate Decree 2023/07', 'Position data, vessel status'],
                        ['Revenue collection and financial reporting', 'Legal obligation — Finance Act 2024, Art. 8', 'Transaction, payment records'],
                        ['Platform access control and identity verification', 'Legitimate interest — Platform security', 'User credentials, session data'],
                        ['Immutable audit trail for governance accountability', 'Legal obligation — Government Audit Act 2022', 'User actions, IP logs'],
                        ['Carbon credit issuance and environmental reporting', 'Public interest — Green Finance Policy 2024', 'CO₂ data, offset records'],
                        ['Fraud detection and anomaly monitoring', 'Legitimate interest — SMCA Security Policy', 'Access patterns, IP addresses'],
                        ['Statistical reporting to international bodies (IMO, AU)', 'Legal obligation — MARPOL Annex VI', 'Aggregated vessel/emission data'],
                    ]}
                />
            </LegalSection>

            {/* 05 */}
            <LegalSection id="legal-basis" number="05" title="Legal Basis for Processing">
                <LegalP>
                    Processing of personal data on Africgreen is grounded in the following legal bases under the Somaliland Data Protection Act 2023 and aligned international frameworks:
                </LegalP>
                <LegalUl>
                    <LegalLi><strong>Legal Obligation (Art. 6(1)(c) equivalent):</strong> Maritime Carbon Act 2024, IMO MARPOL Annex VI, Somaliland Finance Act 2024 — processing is mandatory for tax enforcement and cannot be refused by data subjects operating within the EEZ.</LegalLi>
                    <LegalLi><strong>Public Task (Art. 6(1)(e) equivalent):</strong> Sovereign mandate of the SMCA to monitor, regulate, and report on carbon emissions within Somaliland maritime jurisdiction.</LegalLi>
                    <LegalLi><strong>Legitimate Interests (Art. 6(1)(f) equivalent):</strong> Platform security, fraud prevention, and immutable audit logging — balanced against the rights of data subjects and documented in our Legitimate Interest Assessment (LIA/2024-03).</LegalLi>
                    <LegalLi><strong>Contractual Necessity (Art. 6(1)(b) equivalent):</strong> For Shipping Agents and Armateurs who register on the platform, processing is necessary to fulfil the digital services agreement and tax payment obligations.</LegalLi>
                </LegalUl>
                <LegalWarning>
                    <strong>Note on Sensitive Data:</strong> Africgreen does not process special categories of personal data (health, biometric, political affiliation) within the meaning of Art. 9 GDPR or equivalent Somaliland law. AIS positional data of vessels is not considered personal data under maritime law but is handled with equivalent security standards.
                </LegalWarning>
            </LegalSection>

            {/* 06 */}
            <LegalSection id="retention" number="06" title="Data Retention">
                <LegalTable
                    headers={['Data Category', 'Retention Period', 'Legal Basis']}
                    rows={[
                        ['User account & credentials', '5 years after account deactivation', 'Finance Act 2024, Art. 31'],
                        ['Audit log entries (immutable)', '10 years', 'Government Audit Act 2022, Art. 18'],
                        ['Transaction & invoice records', '7 years', 'Tax Administration Act 2023, Art. 44'],
                        ['AIS position data (raw)', '2 years', 'SMCA Data Governance Policy 2024'],
                        ['CO₂ emission estimates & credits', '10 years', 'Maritime Carbon Act 2024, Art. 29'],
                        ['Session tokens & IP logs', '90 days', 'Security Policy SP-2024-01'],
                        ['Pro-forma invoice PDFs', '7 years', 'Tax Administration Act 2023, Art. 44'],
                        ['Exemption records', '10 years', 'Maritime Carbon Act 2024, Art. 17'],
                    ]}
                />
                <LegalP>
                    Upon expiry of the applicable retention period, data is securely deleted using cryptographic erasure (overwrite + key destruction) or anonymized for statistical archival. Deletion records are themselves maintained for 2 years.
                </LegalP>
            </LegalSection>

            {/* 07 */}
            <LegalSection id="sharing" number="07" title="Data Sharing & International Transfers">
                <LegalP>We do not sell, rent, or commercially transfer personal data. Data may be shared only in the following circumstances:</LegalP>
                <LegalUl>
                    <LegalLi><strong>International Maritime Organization (IMO):</strong> Aggregated, anonymized emission statistics transmitted annually under MARPOL Annex VI reporting obligations.</LegalLi>
                    <LegalLi><strong>African Union / ITPGRFA:</strong> Environmental data shared as part of Somaliland's continental climate commitments — never at individual vessel level without explicit legal basis.</LegalLi>
                    <LegalLi><strong>Neighboring Coast Guard Authorities (Djibouti, Eritrea):</strong> Position data of vessels under investigation for non-compliance, pursuant to bilateral maritime agreements.</LegalLi>
                    <LegalLi><strong>Ministry of Justice:</strong> Audit logs and financial records in the context of criminal investigations, subject to judicial warrant.</LegalLi>
                    <LegalLi><strong>Technical Subprocessors:</strong> Cloud infrastructure and database services operating within Somaliland territory (BER-DC1) or subject to adequate data protection frameworks. All subprocessors are bound by Data Processing Agreements (DPAs).</LegalLi>
                </LegalUl>
                <LegalWarning>
                    <strong>International transfers outside Africa:</strong> Any transfer of personal data to countries not recognized as offering adequate protection requires Standard Contractual Clauses (SCCs) and is subject to SDPC approval. No bulk transfer of vessel owner or operator data is made to non-adequate third countries without explicit authorization.
                </LegalWarning>
            </LegalSection>

            {/* 08 */}
            <LegalSection id="rights" number="08" title="Your Rights">
                <LegalP>
                    Subject to applicable Somaliland law and operational constraints, data subjects have the following rights. Certain rights may be limited where they would interfere with mandatory legal processing obligations (e.g., tax enforcement, audit immutability):
                </LegalP>
                <LegalTable
                    headers={['Right', 'Scope', 'Limitation']}
                    rows={[
                        ['Access (Art. 15)', 'Request a copy of data held about you', 'May be restricted if data relates to an ongoing enforcement action'],
                        ['Rectification (Art. 16)', 'Correct inaccurate personal data', 'Audit log entries are immutable by design — cannot be altered'],
                        ['Erasure (Art. 17)', 'Request deletion of personal data', 'Does not apply to data subject to legal retention obligations'],
                        ['Restriction (Art. 18)', 'Limit processing during a dispute', 'Does not apply to active tax enforcement processing'],
                        ['Portability (Art. 20)', 'Receive your data in machine-readable format', 'Available for account data; not for vessel or AIS data'],
                        ['Objection (Art. 21)', 'Object to processing based on legitimate interest', 'Not applicable to legal obligation or public task processing'],
                        ['Complaint', 'Lodge a complaint with the SDPC', 'Always available — see contact details below'],
                    ]}
                />
                <LegalP>
                    To exercise your rights, submit a written request to <strong>dpo@smca.gov.sl</strong> with proof of identity. We will respond within <strong>30 calendar days</strong>. Complex or multiple requests may be extended by an additional 60 days with notification.
                </LegalP>
            </LegalSection>

            {/* 09 */}
            <LegalSection id="ais-data" number="09" title="AIS & Maritime Surveillance Data">
                <LegalHighlight>
                    The Automatic Identification System (AIS) is a mandatory radio transponder system under IMO SOLAS Chapter V Regulation 19. AIS data broadcast by vessels in the Somaliland EEZ is received by sovereign shore-based receivers and is considered publicly accessible technical data under international maritime law. Its collection and use for safety, environmental, and tax enforcement purposes does not require individual vessel owner consent.
                </LegalHighlight>
                <LegalP>
                    Within Africgreen, AIS data is used exclusively for: (i) identifying vessels within the EEZ for carbon tax assessment, (ii) calculating estimated CO₂ emissions based on vessel speed, position, and engine specifications, (iii) generating pro-forma invoices and compliance notices, and (iv) populating the Command Center map display for authorized officers.
                </LegalP>
                <LegalP>
                    AIS position data is never used for commercial tracking, sold to third parties, or shared beyond the purposes listed above. Raw AIS feeds are retained for 2 years and then purged from primary systems.
                </LegalP>
            </LegalSection>

            {/* 10 */}
            <LegalSection id="security" number="10" title="Data Security">
                <LegalP>
                    Africgreen implements a multi-layered security architecture in accordance with ISO/IEC 27001:2022, the IMO Maritime Cyber Risk Management guidelines, and the NIST Cybersecurity Framework (CSF 2.0):
                </LegalP>
                <LegalUl>
                    <LegalLi><strong>Encryption at rest:</strong> AES-256 for all stored data, with hardware security modules (HSMs) for key management at BER-DC1.</LegalLi>
                    <LegalLi><strong>Encryption in transit:</strong> TLS 1.3 for all API and web traffic. Older TLS versions (≤1.2) are rejected at the load balancer.</LegalLi>
                    <LegalLi><strong>Access control:</strong> Role-Based Access Control (RBAC) with least-privilege principles. All privileged actions require MFA. Superadmin actions require dual authorization.</LegalLi>
                    <LegalLi><strong>Immutable audit logging:</strong> All operator actions are SHA-256 hash-chained and stored in a tamper-evident append-only log.</LegalLi>
                    <LegalLi><strong>Penetration testing:</strong> Annual independent penetration tests by certified third parties. Results disclosed in the Security Audit report.</LegalLi>
                    <LegalLi><strong>Incident response:</strong> Data breach notification to the SDPC within 72 hours, affected data subjects within 5 business days, in accordance with Art. 33–34 GDPR equivalent.</LegalLi>
                </LegalUl>
            </LegalSection>

            {/* 11 */}
            <LegalSection id="cookies" number="11" title="Cookies & Session Management">
                <LegalP>
                    Africgreen uses strictly necessary cookies and session tokens only. No advertising, analytics, or tracking cookies are used.
                </LegalP>
                <LegalTable
                    headers={['Cookie / Token', 'Purpose', 'Duration', 'Type']}
                    rows={[
                        ['sb-auth-token', 'Supabase authentication session', '15 minutes (auto-extended on activity)', 'HTTP-Only, Secure, SameSite=Strict'],
                        ['smca-csrf', 'Cross-Site Request Forgery protection', 'Session (browser close)', 'HTTP-Only, Secure'],
                        ['locale-pref', 'User language preference (EN/SO/AR)', '1 year', 'Secure, SameSite=Lax'],
                        ['smca-session-id', 'Audit trail session correlation', '24 hours', 'HTTP-Only, Secure'],
                    ]}
                />
                <LegalP>
                    Sessions expire automatically after <strong>15 minutes of inactivity</strong> as a security measure. This cannot be disabled by users. Session tokens are invalidated server-side on logout and cannot be reused.
                </LegalP>
            </LegalSection>

            {/* 12 */}
            <LegalSection id="contact" number="12" title="Contact & Complaints">
                <LegalTable
                    headers={['Contact Type', 'Details']}
                    rows={[
                        ['Data Protection Officer (DPO)', 'dpo@smca.gov.sl · Response within 5 business days'],
                        ['General Inquiries', 'info@smca.gov.sl · Ministry of Finance, Hargeisa, Somaliland'],
                        ['Security Incidents', 'security@smca.gov.sl · PGP key available at smca.gov.sl/pgp'],
                        ['Data Subject Rights Requests', 'rights@smca.gov.sl · Response within 30 calendar days'],
                        ['Supervisory Authority', 'Somaliland Data Protection Commissioner (SDPC) · sdpc.gov.sl'],
                    ]}
                />
                <LegalP>
                    If you believe your privacy rights have been violated, you have the right to lodge a complaint with the <strong>Somaliland Data Protection Commissioner (SDPC)</strong> at any time, without prejudice to any other administrative or judicial remedy. The SDPC contact is available at <strong>sdpc.gov.sl</strong>.
                </LegalP>
                <LegalHighlight>
                    This Privacy Policy was last reviewed and approved by the Somaliland Data Protection Officer on <strong>March 1, 2025</strong>. Changes to this policy will be published at least 30 days before taking effect, with notification to all registered platform users via email.
                </LegalHighlight>
            </LegalSection>
        </LegalPageShell>
    );
}
