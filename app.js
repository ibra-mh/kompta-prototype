
// ===== KOMPTA TAX ENGINE (Python/FastAPI backend) CONNECTION =====
// Start the backend first: `python run.py` inside kompta_tax_export/
// It must be running at this address for export buttons to work.
// Served over http(s) the app is same-origin; only file:// falls back to the loopback backend.
const KOMPTA_API_BASE = window.location.protocol === 'file:' ? 'http://127.0.0.1:8000' : '';
const KOMPTA_API_LABEL = KOMPTA_API_BASE || window.location.origin;
// The ngrok free-tier interstitial would otherwise replace JSON API responses with HTML.
function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('ngrok-skip-browser-warning', 'true');
  return fetch(url, { ...options, headers });
}
// CGNC account roots shared by every prefix check in the UI.
const CGNC = Object.freeze({ CLIENTS:'3421', FOURNISSEURS:'4411', TVA_RECUPERABLE:'3455', TVA_FACTUREE:'4455', CHARGES:'6', PRODUITS:'7', CAISSE:'516' });
function isAccount(code, ...roots) { const value = String(code); return roots.some(root => value.startsWith(root)); }
function apiConnectionErrorMessage(error, action) {
  if (error instanceof TypeError) {
    return `${action} : le navigateur ne peut pas lire ${KOMPTA_API_LABEL} depuis ${window.location.origin} (serveur arrêté ou réponse CORS bloquée). Redémarrez avec python run.py; Live Server est autorisé par défaut sur http://127.0.0.1:5500.`;
  }
  return error?.message || `${action} impossible.`;
}

// ===== REAL CLIENT / FISCAL-YEAR SETUP =====
let managedClients = [];
let selectedManagedClientId = '';

function managedClientToDossier(client) {
  const openYear = (client.years || []).find(item => item.status === 'open') || (client.years || [])[0];
  return {
    id: client.id,
    name: client.name,
    ice: client.ice || '—',
    forme: client.legalForm || '—',
    exercice: openYear?.year || null,
    tva_regime: client.tvaRegime,
    tva_periodicite: client.tvaPeriodicite,
    status: openYear?.status === 'closed' ? 'clôturé' : 'actif',
    balanceStatus: 'ok',
    isDemo: false
  };
}

function syncManagedClientsIntoData() {
  DATA.dossiers = DATA.dossiers.filter(d => d.isDemo !== false);
  managedClients.forEach(client => {
    const dossier = managedClientToDossier(client);
    DATA.dossiers.push(dossier);
    if (!DATA.clientData[client.id]) DATA.clientData[client.id] = { a_nouveaux_by_year: {}, journal_entries: [] };
  });
}

function setClientManagerStatus(message, type = 'gray') {
  const el = document.getElementById('client-manager-status');
  if (!el) return;
  el.textContent = message;
  el.className = `status s-${type}`;
  el.style.display = message ? 'inline-flex' : 'none';
}

async function loadManagedClients() {
  try {
    const response = await apiFetch(`${KOMPTA_API_BASE}/api/clients?include_demo=false`);
    if (!response.ok) throw new Error('Impossible de charger les clients réels.');
    managedClients = await response.json();
    syncManagedClientsIntoData();
    renderManagedClients();
    renderDossierScreen();
    setClientManagerStatus(`${managedClients.length} client(s) réel(s) enregistré(s).`, 'green');
  } catch (error) {
    setClientManagerStatus(apiConnectionErrorMessage(error, 'Chargement des clients'), 'red');
  }
}

function resetManagedClientForm() {
  selectedManagedClientId = '';
  ['managed-client-id', 'managed-client-name', 'managed-client-ice', 'managed-client-form'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('managed-client-regime').value = 'Débit';
  document.getElementById('managed-client-period').value = 'Mensuelle';
  document.getElementById('managed-years-list').textContent = 'Sélectionnez un client réel pour gérer ses exercices.';
}

function editManagedClient(clientId) {
  const client = managedClients.find(item => item.id === clientId);
  if (!client) return;
  selectedManagedClientId = client.id;
  document.getElementById('managed-client-id').value = client.id;
  document.getElementById('managed-client-name').value = client.name;
  document.getElementById('managed-client-ice').value = client.ice || '';
  document.getElementById('managed-client-form').value = client.legalForm || '';
  document.getElementById('managed-client-regime').value = client.tvaRegime;
  document.getElementById('managed-client-period').value = client.tvaPeriodicite;
  document.getElementById('managed-year').value = '';
  renderManagedYears(client);
}

function renderManagedYears(client) {
  const el = document.getElementById('managed-years-list');
  if (!el) return;
  el.innerHTML = (client.years || []).length
    ? client.years.map(item => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);"><span>Exercice ${item.year}</span><span>${item.status === 'open' ? 'Ouvert' : 'Clôturé'} <button class="btn btn-s btn-xs" data-action="editManagedYear(${item.year},'${item.status}')">Modifier</button></span></div>`).join('')
    : 'Aucun exercice enregistré.';
}

function editManagedYear(year, status) {
  document.getElementById('managed-year').value = year;
  document.getElementById('managed-year-status').value = status;
}

function renderManagedClients() {
  const list = document.getElementById('managed-clients-list');
  if (!list) return;
  if (!managedClients.length) {
    list.innerHTML = '<div style="padding:14px;color:var(--muted);font-size:11px;">Aucun client réel. Créez le premier client à gauche.</div>';
    return;
  }
  list.innerHTML = managedClients.map(client => `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;border-bottom:1px solid var(--border);"><div><strong>${menuEscape(client.name)}</strong><div style="font-size:10px;color:var(--muted);">${menuEscape(client.legalForm || '—')} · ICE ${menuEscape(client.ice || '—')} · Réel</div></div><button class="btn btn-s btn-xs" data-action="editManagedClient('${client.id}')">Modifier</button></div>`).join('');
  if (selectedManagedClientId) {
    const selected = managedClients.find(client => client.id === selectedManagedClientId);
    if (selected) renderManagedYears(selected);
  }
}

async function saveManagedClient() {
  const payload = {
    name: document.getElementById('managed-client-name').value,
    ice: document.getElementById('managed-client-ice').value,
    legalForm: document.getElementById('managed-client-form').value,
    tvaRegime: document.getElementById('managed-client-regime').value,
    tvaPeriodicite: document.getElementById('managed-client-period').value
  };
  if (!payload.name.trim() || !payload.legalForm.trim()) {
    setClientManagerStatus('La raison sociale et la forme juridique sont obligatoires.', 'red');
    return;
  }
  const id = document.getElementById('managed-client-id').value;
  try {
    const response = await apiFetch(`${KOMPTA_API_BASE}/api/clients${id ? `/${encodeURIComponent(id)}` : ''}`, {
      method: id ? 'PUT' : 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail?.message || 'Enregistrement impossible.');
    await loadManagedClients();
    editManagedClient(data.id);
    showToast(id ? 'Client réel mis à jour ✓' : 'Client réel créé ✓', 'success');
  } catch (error) {
    setClientManagerStatus(apiConnectionErrorMessage(error, 'Enregistrement du client'), 'red');
  }
}

async function saveManagedFiscalYear() {
  const clientId = document.getElementById('managed-client-id').value || selectedManagedClientId;
  const year = Number(document.getElementById('managed-year').value);
  const status = document.getElementById('managed-year-status').value;
  if (!clientId) { setClientManagerStatus('Sélectionnez d’abord un client réel.', 'red'); return; }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) { setClientManagerStatus('Saisissez une année entre 2000 et 2100.', 'red'); return; }
  try {
    const response = await apiFetch(`${KOMPTA_API_BASE}/api/clients/${encodeURIComponent(clientId)}/fiscal-years`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({year, status})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail?.message || 'Enregistrement impossible.');
    await loadManagedClients();
    editManagedClient(clientId);
    showToast(`Exercice ${year} enregistré ✓`, 'success');
  } catch (error) {
    setClientManagerStatus(apiConnectionErrorMessage(error, 'Enregistrement de l’exercice'), 'red');
  }
}

function openClientManager() {
  resetManagedClientForm();
  openModal('modalClientManager');
  loadManagedClients();
}

// ===== DATA =====
const DATA = {
  dossiers: [
    { id:'C001', name:'SARL Brahim & Fils', ice:'001234567000045', forme:'SARL', exercice:2026, tva_regime:'Encaissement', tva_periodicite:'Mensuelle', status:'actif', balanceStatus:'erreur' },
    { id:'C002', name:'Auto-Entrepreneur Karim', ice:'002345678000012', forme:'Auto-entrepreneur', exercice:2026, tva_regime:'Débit', tva_periodicite:'Trimestrielle', status:'actif', balanceStatus:'ok' },
    { id:'C003', name:'Import-Export Merouane', ice:'003456789000078', forme:'SARL', exercice:2025, tva_regime:'Débit', tva_periodicite:'Mensuelle', status:'en-cours', balanceStatus:'ok', demoTresorerie:6200, demoChiffreAffaires:7500, demoTvaRate:20 },
    { id:'C004', name:'Cabinet Dental Hamid', ice:'004567890000034', forme:'SA', exercice:2026, tva_regime:'Exonéré', tva_periodicite:'—', status:'actif', balanceStatus:'ok', demoTresorerie:30000, demoChiffreAffaires:18000, demoTvaRate:0 },
    { id:'C005', name:'Librairie Alif SARL', ice:'005678901000056', forme:'SARL', exercice:2026, tva_regime:'Débit', tva_periodicite:'Mensuelle', status:'actif', balanceStatus:'ok', demoTresorerie:9800, demoChiffreAffaires:18500, demoTvaRate:20 },
    { id:'C006', name:'STE Atlas Négoce', ice:'006789012000067', forme:'SARL', exercice:2026, tva_regime:'Encaissement', tva_periodicite:'Mensuelle', status:'actif', balanceStatus:'ok', demoTresorerie:27500, demoChiffreAffaires:32000, demoTvaRate:20 },
    { id:'C007', name:'Pharmacie Zineb', ice:'007890123000089', forme:'Personne physique', exercice:2026, tva_regime:'Exonéré', tva_periodicite:'—', status:'actif', balanceStatus:'ok', demoTresorerie:15300, demoChiffreAffaires:12000, demoTvaRate:0 },
    { id:'C008', name:'Ferronnerie Al Amal', ice:'008901234000090', forme:'SARL', exercice:2025, tva_regime:'Débit', tva_periodicite:'Trimestrielle', status:'en-cours', balanceStatus:'ok', demoTresorerie:4100, demoChiffreAffaires:14500, demoTvaRate:20 },
    { id:'C009', name:'Traiteur Doha Events', ice:'009012345000011', forme:'Auto-entrepreneur', exercice:2026, tva_regime:'Encaissement', tva_periodicite:'Trimestrielle', status:'actif', balanceStatus:'ok', demoTresorerie:12750, demoChiffreAffaires:22000, demoTvaRate:20 },
    { id:'C010', name:'Transport Salim & Co', ice:'010123456000022', forme:'SARL', exercice:2026, tva_regime:'Débit', tva_periodicite:'Mensuelle', status:'actif', balanceStatus:'ok', demoTresorerie:38900, demoChiffreAffaires:48000, demoTvaRate:20 }
  ],
  // Only verified CGNC accounts belong in this collection.
  accounts: [],
  // Données comptables propres à chaque dossier (client) — clé = id du dossier
  clientData: {
    // ===== C001 — SARL Brahim & Fils (2026 actif, 2025 clôturé) =====
    C001: {
      a_nouveaux_by_year: {
        2026: [
          { code:'1111', debit:0, credit:100000 },
          { code:'3421', debit:8440, credit:0 },
          { code:'4411', debit:0, credit:3600 },
          { code:'5141', debit:15000, credit:0 }
        ],
        2025: [
          { code:'1111', debit:0, credit:100000 },
          { code:'3421', debit:5200, credit:0 },
          { code:'4411', debit:0, credit:2100 },
          { code:'5141', debit:8500, credit:0 }
        ]
      },
      journal_entries: [
        { piece:'JA-001', journal:'ACHATS', jour:'01', mois:'06', year:2026, libelle:'Facture Rédal électricité', n_facture:'FN2026-0541', n_mvt:262041, lines:[
          { compte:'6125', libelle:'Facture Rédal électricité', dbcr:'D', montant:5000, tva:0, code:0 },
          { compte:'3455220', libelle:'TVA récupérable 20%', dbcr:'D', montant:1000, tva:20, code:140 },
          { compte:'4411', auxiliaire:'44110002', libelle:'Rédal Tétouan', dbcr:'C', montant:6000, tva:0, code:0 }
        ]},
        { piece:'JV-001', journal:'VENTES', jour:'03', mois:'06', year:2026, libelle:'FAC-045 Client Karim', n_facture:'FA2026-045', n_mvt:262042, lines:[
          { compte:'3421', auxiliaire:'34210001', libelle:'FAC-045 Karim', dbcr:'D', montant:12000, tva:0, code:0 },
          { compte:'7111', libelle:'FAC-045 Karim', dbcr:'C', montant:10000, tva:0, code:0 },
          { compte:'445520', libelle:'TVA facturée 20%', dbcr:'C', montant:2000, tva:20, code:140 }
        ]},
        { piece:'JB-001', journal:'BANQUE', jour:'10', mois:'06', year:2026, libelle:'Règlement Karim', n_facture:'', n_mvt:262043, lines:[
          { compte:'5141', libelle:'Règlement Karim', dbcr:'D', montant:12000, tva:0, code:0 },
          { compte:'3421', auxiliaire:'34210001', libelle:'Règlement Karim', dbcr:'C', montant:12000, tva:0, code:0 }
        ]},
        // ----- Exercice 2025 (clôturé le 31/01/2026) — lecture seule -----
        { piece:'JA-001', journal:'ACHATS', jour:'05', mois:'03', year:2025, libelle:'Facture Orange Maroc', n_facture:'FN2025-0112', n_mvt:251001, lines:[
          { compte:'6125', libelle:'Facture Orange Maroc', dbcr:'D', montant:3000, tva:0, code:0 },
          { compte:'3455220', libelle:'TVA récupérable 20%', dbcr:'D', montant:600, tva:20, code:140 },
          { compte:'4411', auxiliaire:'44110001', libelle:'Orange Maroc', dbcr:'C', montant:3600, tva:0, code:0 }
        ]},
        { piece:'JV-001', journal:'VENTES', jour:'12', mois:'04', year:2025, libelle:'FAC-2025-032 Client Maroine', n_facture:'FA2025-032', n_mvt:251002, lines:[
          { compte:'3421', auxiliaire:'34210002', libelle:'FAC-032 Maroine', dbcr:'D', montant:9600, tva:0, code:0 },
          { compte:'7111', libelle:'FAC-032 Maroine', dbcr:'C', montant:8000, tva:0, code:0 },
          { compte:'445520', libelle:'TVA facturée 20%', dbcr:'C', montant:1600, tva:20, code:140 }
        ]},
        { piece:'JB-001', journal:'BANQUE', jour:'20', mois:'04', year:2025, libelle:'Règlement Maroine', n_facture:'', n_mvt:251003, lines:[
          { compte:'5141', libelle:'Règlement Maroine', dbcr:'D', montant:9600, tva:0, code:0 },
          { compte:'3421', auxiliaire:'34210002', libelle:'Règlement Maroine', dbcr:'C', montant:9600, tva:0, code:0 }
        ]}
      ]
    },
    // ===== C002 — Auto-Entrepreneur Karim (2026 actif) =====
    C002: {
      a_nouveaux_by_year: {
        2026: [
          { code:'1111', debit:0, credit:20000 },
          { code:'3421', debit:2000, credit:0 },
          { code:'5141', debit:5000, credit:0 }
        ]
      },
      journal_entries: [
        { piece:'JV-001', journal:'VENTES', jour:'08', mois:'02', year:2026, libelle:'Prestation design', n_facture:'AE2026-001', n_mvt:120001, lines:[
          { compte:'3421', auxiliaire:'34210001', libelle:'Prestation design', dbcr:'D', montant:6000, tva:0, code:0 },
          { compte:'7111', libelle:'Prestation design', dbcr:'C', montant:5000, tva:0, code:0 },
          { compte:'445520', libelle:'TVA facturée 20%', dbcr:'C', montant:1000, tva:20, code:140 }
        ]},
        { piece:'JB-001', journal:'BANQUE', jour:'15', mois:'02', year:2026, libelle:'Encaissement client', n_facture:'', n_mvt:120002, lines:[
          { compte:'5141', libelle:'Encaissement client', dbcr:'D', montant:6000, tva:0, code:0 },
          { compte:'3421', auxiliaire:'34210001', libelle:'Encaissement client', dbcr:'C', montant:6000, tva:0, code:0 }
        ]}
      ]
    },
    // ===== C003 — Import-Export Merouane (2025 actif) =====
    C003: {
      a_nouveaux_by_year: {
        2025: [
          { code:'1111', debit:0, credit:50000 },
          { code:'4411', debit:0, credit:4000 },
          { code:'5141', debit:12000, credit:0 }
        ]
      },
      journal_entries: [
        { piece:'JA-001', journal:'ACHATS', jour:'10', mois:'02', year:2025, libelle:'Import marchandises Azulex', n_facture:'IM2025-014', n_mvt:130001, lines:[
          { compte:'61211', libelle:'Import marchandises Azulex', dbcr:'D', montant:8000, tva:0, code:0 },
          { compte:'3455220', libelle:'TVA récupérable 20%', dbcr:'D', montant:1600, tva:20, code:140 },
          { compte:'44110003', libelle:'STE Azulex', dbcr:'C', montant:9600, tva:0, code:0 }
        ]},
        { piece:'JB-001', journal:'BANQUE', jour:'25', mois:'02', year:2025, libelle:'Règlement Azulex', n_facture:'', n_mvt:130002, lines:[
          { compte:'44110003', libelle:'Règlement Azulex', dbcr:'D', montant:9600, tva:0, code:0 },
          { compte:'5141', libelle:'Règlement Azulex', dbcr:'C', montant:9600, tva:0, code:0 }
        ]}
      ]
    },
    // ===== C004 — Cabinet Dental Hamid (2026 actif) =====
    C004: {
      a_nouveaux_by_year: {
        2026: [
          { code:'1111', debit:0, credit:80000 },
          { code:'3421', debit:4000, credit:0 },
          { code:'5141', debit:30000, credit:0 }
        ]
      },
      journal_entries: [
        { piece:'JV-001', journal:'VENTES', jour:'06', mois:'01', year:2026, libelle:'Soins dentaires', n_facture:'CD2026-007', n_mvt:140001, lines:[
          { compte:'3421', auxiliaire:'34210002', libelle:'Soins dentaires', dbcr:'D', montant:3600, tva:0, code:0 },
          { compte:'7111', libelle:'Soins dentaires', dbcr:'C', montant:3000, tva:0, code:0 },
          { compte:'445520', libelle:'TVA facturée 20%', dbcr:'C', montant:600, tva:20, code:140 }
        ]},
        { piece:'JC-001', journal:'CAISSE', jour:'06', mois:'01', year:2026, libelle:'Encaissement espèces', n_facture:'', n_mvt:140002, lines:[
          { compte:'5161', libelle:'Encaissement espèces', dbcr:'D', montant:3600, tva:0, code:0 },
          { compte:'3421', auxiliaire:'34210002', libelle:'Encaissement espèces', dbcr:'C', montant:3600, tva:0, code:0 }
        ]}
      ]
    }
  }
};

// ===== DERIVED LOOKUPS =====
Object.values(DATA.clientData).forEach(client => {
  (client.journal_entries || []).forEach(entry => { entry.demoOnly = true; });
});
DATA.dossiers.forEach(dossier => { dossier.isDemo = true; });

// code → label map for quick resolution
const ACCOUNTS = {};
// Comptes divisionnaires fournisseurs (parent 4411) used by the account popup
// Official CGNC codes (cgnc_standard_accounts.json + supplement), filled by loadCgncChart().
const CGNC_CODES = new Set();
let PCM_HIERARCHY = [];
function cgncRoot(code) {
  const value = String(code).trim();
  if (!/^\d+$/.test(value)) return null;
  for (let length = value.length; length > 0; length--) if (CGNC_CODES.has(value.slice(0, length))) return value.slice(0, length);
  return null;
}
function rebuildAccountIndexes() {
  Object.keys(ACCOUNTS).forEach(code => delete ACCOUNTS[code]);
  DATA.accounts.filter(a => a.standard).forEach(a => { ACCOUNTS[a.code] = a.label; });
  // window.PCM_MAROC backs account lookups; PCM_HIERARCHY retains all tree nodes for the chart view.
  window.PCM_MAROC = DATA.accounts.filter(a => a.standard)
    .map(a => ({ code:a.code, libelle:a.label, classe:a.classe || Number(String(a.code).charAt(0)) }));
}
rebuildAccountIndexes();
function applyCgncChart(chart) {
  PCM_HIERARCHY = chart.map(account => ({ ...account }));
  CGNC_CODES.clear();
  chart.filter(account => account.level !== 'class').forEach(account => CGNC_CODES.add(account.code));
  const standard = chart.filter(a => a.level !== 'class').map(a => ({
    code:a.code,
    label:a.label,
    type:'parent',
    classe:a.class,
    standard:true,
    cgncStatus:a.status,
    parent:a.parent,
    level:a.level
  }));
  DATA.accounts.splice(0, DATA.accounts.length, ...standard);
  rebuildAccountIndexes();
}
async function loadCgncChart() {
  try {
    const response = await apiFetch(`${KOMPTA_API_BASE}/api/accounts/cgnc`);
    if (!response.ok) throw new Error(`Plan comptable CGNC indisponible (HTTP ${response.status}).`);
    applyCgncChart(await response.json());
    renderPlanComptable();
    renderAll();
  } catch (error) {
    showToast(apiConnectionErrorMessage(error, 'Chargement du plan comptable CGNC'), 'error');
  }
}
function isStandardAccount(code) {
  return PCM_HIERARCHY.some(account => account.code === code) || DATA.accounts.some(a => a.code === code && a.standard);
}
function pcmBaseAccounts() {
  const byCode = new Map();
  DATA.accounts.forEach(a => { if (!byCode.has(a.code)) byCode.set(a.code, a); });
  return (window.PCM_MAROC || []).map(p => byCode.get(p.code) || { code:p.code, label:p.libelle, type:'parent', classe:p.classe });
}
function pcmAccountDetails(account) {
  const code = String(account.code);
  const classe = Number(code.charAt(0));
  return { ...account, code, classe, rubrique:code.slice(0, 2), poste:code.slice(0, 3), type:classe <= 3 ? 'Actif' : classe <= 5 ? 'Passif' : classe === 6 ? 'Charges' : 'Produits', statement:classe <= 5 ? 'Bilan' : 'CPC' };
}
function getAccountByCode(code) { const account = pcmBaseAccounts().find(a => a.code === String(code).trim()); return account ? pcmAccountDetails(account) : null; }
function getRootAccount(auxiliaryCode) { const root = String(auxiliaryCode).trim().slice(0, 4); return getAccountByCode(root); }
function searchAccounts(searchTerm) { const term = String(searchTerm || '').trim().toLowerCase(); return pcmBaseAccounts().map(pcmAccountDetails).filter(a => !term || a.code.includes(term) || a.label.toLowerCase().includes(term)); }
function getAccountsByClass(classNumber) { return pcmBaseAccounts().map(pcmAccountDetails).filter(a => a.classe === Number(classNumber)); }

// Journal definitions: display name + pièce prefix used for auto-numbering
const JOURNALS = [
  { name:'VENTES', code:'VT', prefix:'JV' },
  { name:'ACHATS', code:'AC', prefix:'JA' },
  { name:'BANQUE', code:'BQ', prefix:'JB' },
  { name:'CAISSE', code:'CA', prefix:'JC' },
  { name:'OD', code:'OD', prefix:'OD' }
];
function journalPrefix(name) { const j = JOURNALS.find(j => j.name === name); return j ? j.prefix : 'OD'; }

// Exercices clôturés : date de clôture par année (aucune donnée pour 2024/2023)
const CLOSED_DATES = { 2025:'31/01/2026', 2024:'15/02/2025', 2023:'20/03/2024', 2022:'10/04/2023' };

// ===== CLIENT (DOSSIER) SCOPING =====
// Dossier actif — toutes les vues lisent les données de ce client uniquement.
// (currentClientId / currentYear restent synchronisés avec AppState pour
//  compatibilité avec le code existant.)
let currentClientId = 'C001';
const AUXILIARY_ACCOUNTS = {};
let pendingAuxImport = [];
const AUX_FIELDS = ['compte_auxiliaire', 'libelle', 'compte_racine', 'ice', 'identifiant_fiscal', 'type_tiers'];
const AUX_TYPES = ['Fournisseur', 'Client', 'Banque', 'Autre'];
function activeAuxiliaryAccounts() { return AUXILIARY_ACCOUNTS[currentClientId] || (AUXILIARY_ACCOUNTS[currentClientId] = []); }
function auxiliaryContact(code, clientId = currentClientId) {
  return (AUXILIARY_ACCOUNTS[clientId] || []).find(account => account.compte_auxiliaire === code) || null;
}
function seedDemoAuxiliaryAccounts() {
  const demoContacts = {
    '34210001': { libelle:'Client Karim', ice:'002345678000012', identifiant_fiscal:'', type_tiers:'Client' },
    '34210002': { libelle:'Client Maroine', ice:'', identifiant_fiscal:'', type_tiers:'Client' },
    '44110001': { libelle:'Orange Maroc', ice:'', identifiant_fiscal:'', type_tiers:'Fournisseur' },
    '44110002': { libelle:'Rédal Tétouan', ice:'', identifiant_fiscal:'', type_tiers:'Fournisseur' }
  };
  Object.entries(DATA.clientData).forEach(([clientId, data]) => {
    const contacts = AUXILIARY_ACCOUNTS[clientId] || (AUXILIARY_ACCOUNTS[clientId] = []);
    (data.journal_entries || []).forEach(entry => entry.lines.forEach(line => {
      const code = line.auxiliaire;
      const contact = demoContacts[code];
      if (!contact || contacts.some(account => account.compte_auxiliaire === code)) return;
      contacts.push({
        ...contact, compte_auxiliaire:code, compte_racine:code.slice(0, 4)
      });
    }));
  });
}
function currentClient() { return DATA.clientData[AppState.activeClientId] || { a_nouveaux_by_year:{}, journal_entries:[] }; }
// Écritures du dossier actif.
function clientEntries() { return currentClient().journal_entries || []; }
// À-nouveaux du dossier actif pour une année (year → tableau).
function aNouveauxFor(year) { return currentClient().a_nouveaux_by_year[year] || []; }

// Line accessors — a line stores dbcr ('D'/'C') + montant; derive debit/credit.
function lineDebit(l)  { return l.dbcr === 'C' ? 0 : (l.montant || 0); }
function lineCredit(l) { return l.dbcr === 'C' ? (l.montant || 0) : 0; }
function entryDate(e)  { return `${e.jour}/${e.mois}/${e.year}`; }
// Marque d'identification visuelle pour tout N° de facture affiché (Req 1.3).
function factBadge(fact) {
  if (!fact || fact === '—') return '<span style="color:var(--muted);">—</span>';
  return `<span class="at" title="N° de facture">🧾 ${fact}</span>`;
}

// ===== CENTRAL APP STATE =====
// Single source of truth for what the UI is currently showing.
const AppState = {
  activeClientId: 'C001',
  activeYear: 2026,
  activePanel: 'home',
  grandLivreFilter: '',
  lettreCounter: 'AA'
};
// Round to 2 decimals to avoid floating-point drift.
function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function tvaPayable(facturee, recuperable) { return Math.max(0, round2(facturee - recuperable)); }
// Next lettrage pair code (AA→AB→…→AZ→BA→BB…).
function nextLettre() {
  const l = AppState.lettreCounter;
  let first = l.charCodeAt(0), second = l.charCodeAt(1);
  if (second === 90 /* 'Z' */) { second = 65; first += 1; if (first > 90) first = 65; }
  else { second += 1; }
  AppState.lettreCounter = String.fromCharCode(first) + String.fromCharCode(second);
  return l;
}

// ===== HELPERS =====
function fmtFR(n) {
  return (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits:2, maximumFractionDigits:2 }).replace(/\u202f/g, ' ');
}

function parseAmount(value) {
  const normalized = String(value ?? '').replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  return Number(normalized) || 0;
}
function dossierFileName(suffix) {
  const name = DATA.dossiers.find(d => d.id === currentClientId)?.name || currentClientId || 'Dossier';
  return `${String(name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim()}_${suffix}`;
}
function formatAmountInput(input) {
  const amount = parseAmount(input.value);
  input.value = amount ? fmtFR(amount) : '';
  computeTotals();
}
function updateGeneralAccountStyle(input) {
  const code = input.value.trim();
  input.classList.toggle('account-class-6', isAccount(code, CGNC.CHARGES));
  input.classList.toggle('account-class-7', isAccount(code, CGNC.PRODUITS));
}

// Currently active exercise year — drives which data is shown.
let currentYear = 2026;

// Copy the working globals into AppState (single source of truth mirror).
function syncState() {
  AppState.activeClientId = currentClientId;
  AppState.activeYear = currentYear;
}

// ===== REACTIVE RENDER ENGINE =====
// Any change (validation, dossier/year switch, lettrage, clôture) calls
// renderAll() so every view is rebuilt from the in-memory DATA object.
function renderAll() {
  syncState();
  renderHome();
  renderHomeDashboard();
  renderSaisieHistory();
  renderConsultation();
  renderTVA();
}

// Render the "Dernières écritures" table (last 10 entries, most recent first).
function renderSaisieHistory() {
  const tb = document.getElementById('recent-entries-body');
  if (!tb) return;
  const yl = document.getElementById('recent-entries-year');
  if (yl) yl.textContent = 'Exercice ' + currentYear;
  const entries = clientEntries().filter(e => e.year === currentYear);
  tb.innerHTML = '';
  if (!entries.length) {
    tb.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:18px;">Aucune écriture pour l'exercice ${currentYear}</td></tr>`;
    return;
  }
  // Most recent first: last 10 entries, reversed.
  const last = entries.slice(-10).reverse();
  last.forEach(e => {
    const fact = e.n_facture || '';
    e.lines.forEach((l, li) => {
      const d = lineDebit(l), c = lineCredit(l);
      const lineFact = l.facture || fact || '—';
      const tr = document.createElement('tr');
      const action = li === 0 && e.status !== 'REVERSED'
        ? `<td rowspan="${e.lines.length}" style="text-align:center;white-space:nowrap;"><button class="btn btn-s btn-xs" style="color:var(--warning);" data-action="contrepasser('${e.piece}')">Contre-passer</button></td>`
        : li === 0 ? `<td rowspan="${e.lines.length}" style="text-align:center;">REVERSED</td>` : '';
      const lettrage = l.lettre ? `<span class="badge-lettrage">${menuEscape(l.lettre)}</span>` : '<span style="color:var(--muted);">—</span>';
      tr.innerHTML = `<td>${e.piece}</td><td>${entryDate(e)}</td><td>${e.journal}</td><td>${factBadge(lineFact)}</td><td>${l.compte}</td><td>${lettrage}</td><td>${l.libelle||''}</td><td style="text-align:right;">${d ? fmtFR(d) : '—'}</td><td style="text-align:right;">${c ? fmtFR(c) : '—'}</td>${action}`;
      tb.appendChild(tr);
    });
  });
}
// Backward-compat alias for existing callers.
function renderRecentEntries() { renderSaisieHistory(); }

let journalAuditRequest = 0;
async function renderJournalAudit() {
  const body = document.getElementById('journal-audit-body');
  if (!body) return;
  const request = ++journalAuditRequest;
  body.innerHTML = '<tr><td colspan="8" class="empty">Chargement du registre d’audit…</td></tr>';
  try {
    const query = new URLSearchParams({ client_id:currentClientId, year:String(currentYear) });
    const response = await apiFetch(`${KOMPTA_API_BASE}/api/journal-audit?${query}`);
    if (!response.ok) throw new Error(`Lecture du registre d’audit impossible (HTTP ${response.status}).`);
    const events = await response.json();
    if (request !== journalAuditRequest || !document.getElementById('panel-audit')?.classList.contains('active')) return;
    if (!events.length) {
      body.innerHTML = '<tr><td colspan="8" class="empty">Aucun événement d’audit pour cet exercice.</td></tr>';
      return;
    }
    const latestEventByEntry = new Map();
    events.forEach(event => {
      const entryKey = event.entryId ?? event.id;
      if (!latestEventByEntry.has(entryKey)) latestEventByEntry.set(entryKey, event);
    });
    const actionLabels = { DRAFT:'Brouillon', CREATE:'Création', POST:'Validation', REVERSAL:'Contre-passation' };
    body.innerHTML = [...latestEventByEntry.values()].map(event => {
      const timestamp = new Date(event.timestamp);
      const dateHeure = Number.isNaN(timestamp.getTime()) ? event.timestamp : timestamp.toLocaleString('fr-FR');
      const action = event.status === 'REVERSED' ? 'Contre-passation' : actionLabels[event.actionType] || event.actionType;
      const reversalSource = event.details?.sourcePiece ? ` — Contre-passation de ${event.details.sourcePiece}` : '';
      return `<tr><td>${menuEscape(dateHeure)}</td><td>${menuEscape(event.entryDate || '')}</td><td>${menuEscape(event.userId || '')}</td><td>${menuEscape(action)}</td><td>${menuEscape(event.status || 'VALIDATED')}</td><td>${menuEscape(event.piece || '')}</td><td>${menuEscape(event.journal || '')}</td><td>${menuEscape((event.label || '') + reversalSource)}</td></tr>`;
    }).join('');
  } catch (error) {
    if (request !== journalAuditRequest) return;
    body.innerHTML = '<tr><td colspan="8" class="empty">Le registre d’audit est indisponible.</td></tr>';
    showToast(apiConnectionErrorMessage(error, 'Chargement du registre d’audit'), 'error');
  }
}

function handleSaisieJournalChange() {
  const journal = document.getElementById('saisie-journal')?.value;
  configureJournalForm(journal !== activeSaisieJournal);
  activeSaisieJournal = journal;
  suggestPiece();
}

// ===== CONTRE-PASSATION (mirror an entry to cancel it) =====
async function contrepasser(piece) {
  const orig = clientEntries().find(e => e.piece === piece);
  if (!orig) return;
  if (!window.confirm('Créer une contre-passation pour ' + piece + ' ?')) return;
  try {
    const scope = new URLSearchParams({ client_id: currentClientId, year: String(currentYear) });
    const response = await apiFetch(`${KOMPTA_API_BASE}/api/journal-entries/${orig.serverEntryId}/reversal?${scope}` , { method:'POST' });
    if (!response.ok) throw new Error((await response.json()).detail?.message || 'Reversal refusée');
    const posted = await response.json();
    await loadPersistedJournalEntries(currentClientId, currentYear);
    showToast(`Contre-passation ${posted.pieceNumber} créée et auditée ✓`, 'success');
  } catch (error) {
    showToast(apiConnectionErrorMessage(error, 'Contre-passation'), 'error');
  }
}

async function loadPersistedJournalEntries(clientId, year) {
  try {
    const query = new URLSearchParams({ client_id: clientId, year: String(year) });
    const response = await apiFetch(`${KOMPTA_API_BASE}/api/journal-entries?${query}`);
    if (!response.ok) throw new Error(`Lecture des écritures impossible (HTTP ${response.status}).`);
    const persisted = await response.json();
    const client = DATA.clientData[clientId] || (DATA.clientData[clientId] = { a_nouveaux_by_year:{}, journal_entries:[] });
    const knownEntries = new Map(client.journal_entries
      .filter(entry => entry.serverEntryId)
      .map(entry => [entry.serverEntryId, entry]));
    persisted.forEach(entry => {
      const existing = knownEntries.get(entry.serverEntryId);
      if (existing) existing.status = entry.status;
      else client.journal_entries.push(entry);
    });
    if (clientId === currentClientId && year === currentYear) renderAll();
  } catch (error) {
    showToast(apiConnectionErrorMessage(error, 'Chargement des écritures sauvegardées'), 'error');
  }
}

// ===== HOME (live synthèse for active dossier + année) =====
function renderHome() {
  const client = currentClient();
  const dossier = DATA.dossiers.find(x => x.id === currentClientId);
  const titleEl = document.getElementById('home-live-title');
  const badgeEl = document.getElementById('home-live-badge');
  if (titleEl) titleEl.textContent = 'Synthèse — ' + (dossier ? dossier.name : 'dossier actif');
  if (badgeEl) badgeEl.textContent = 'Exercice ' + currentYear;
  const entries = clientEntries().filter(e => e.year === currentYear);
  const anv = aNouveauxFor(currentYear);

  // 1) Solde banque / Solde Caisse — classe 5 (à-nouveaux + mouvements, débit +, crédit −)
  // Les comptes 516x (Caisse) sont isolés des autres comptes de trésorerie (Banques).
  let banque = 0, caisse = 0;
  anv.forEach(a => {
    const code = String(a.code);
    if (code.charAt(0) === '5') {
      const bal = (a.debit || 0) - (a.credit || 0);
      if (isAccount(code, CGNC.CAISSE)) caisse += bal; else banque += bal;
    }
  });
  entries.forEach(e => e.lines.forEach(l => {
    const code = String(l.compte);
    if (code.charAt(0) === '5') {
      const bal = lineDebit(l) - lineCredit(l);
      if (isAccount(code, CGNC.CAISSE)) caisse += bal; else banque += bal;
    }
  }));
  banque = round2(banque);
  caisse = round2(caisse);

  // 2) Chiffre d'affaires — crédits classe 7
  let ca = 0;
  entries.forEach(e => e.lines.forEach(l => {
    if (String(l.compte).charAt(0) === '7') ca += lineCredit(l);
  }));
  ca = round2(ca);

  // 3) TVA facturée / TVA récupérable — affichées séparément
  let tvaFact = 0, tvaRec = 0;
  entries.forEach(e => e.lines.forEach(l => {
    const code = String(l.compte);
    if (isAccount(code, CGNC.TVA_FACTUREE)) tvaFact += lineCredit(l);
    if (isAccount(code, CGNC.TVA_RECUPERABLE)) tvaRec += lineDebit(l);
  }));
  tvaFact = round2(tvaFact);
  tvaRec = round2(tvaRec);

  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('stat-banque', fmtFR(Math.abs(banque)) + ' ' + (banque >= 0 ? 'D' : 'C'));
  setTxt('stat-caisse', fmtFR(Math.abs(caisse)) + ' ' + (caisse >= 0 ? 'D' : 'C'));
  setTxt('stat-ca', fmtFR(ca) + ' MAD');
  setTxt('stat-tva-fact', fmtFR(tvaFact) + ' MAD');
  setTxt('stat-tva-rec', fmtFR(tvaRec) + ' MAD');

  // TVA deadline alert
  renderTvaDeadline(dossier);
}

// Compute the next TVA declaration deadline for any periodicity — reused by the
// per-dossier banner AND by the multi-client "Vue globale" widgets below.
function computeTvaDeadline(periodicite) {
  if (periodicite !== 'Mensuelle' && periodicite !== 'Trimestrielle') return null; // Exonéré, etc.
  const now = new Date();
  let deadline;
  if (periodicite === 'Mensuelle') {
    // 20th of the month following the current month
    deadline = new Date(now.getFullYear(), now.getMonth() + 1, 20);
  } else {
    // Trimestrielle — 20th of the month after the current quarter-end
    const q = Math.floor(now.getMonth() / 3); // 0..3
    const quarterEndMonth = q * 3 + 2;        // 2,5,8,11
    deadline = new Date(now.getFullYear(), quarterEndMonth + 1, 20);
  }
  const days = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
  return { days, dstr: deadline.toLocaleDateString('fr-FR') };
}
// Statut TVA d'un dossier — calculé en direct depuis l'échéance réelle, jamais figé.
function tvaStatusFor(d) {
  const info = computeTvaDeadline(d.tva_periodicite);
  if (!info) return 'exonere';
  if (info.days <= 15) return 'a-declarer';
  return d.tva_periodicite === 'Mensuelle' ? 'a-jour' : 'trimestriel';
}
// Compute the next TVA declaration deadline and show a colored alert.
function renderTvaDeadline(dossier) {
  const alert = document.getElementById('home-tva-alert');
  if (!alert) return;
  const info = dossier ? computeTvaDeadline(dossier.tva_periodicite) : null;
  if (!info) { alert.style.display = 'none'; return; }
  let bg, color, icon;
  if (info.days <= 7) { bg = '#FEE2E2'; color = '#991B1B'; icon = '🔴'; }
  else if (info.days <= 30) { bg = '#FEF3C7'; color = '#92400E'; icon = '🟠'; }
  else { bg = '#D1FAE5'; color = '#065F46'; icon = '🟢'; }
  alert.style.display = 'block';
  alert.style.background = bg;
  alert.style.color = color;
  alert.textContent = `${icon} Prochaine déclaration TVA (${dossier.tva_periodicite}) : ${info.dstr} — dans ${info.days} jour${info.days > 1 ? 's' : ''}`;
}

// ===== TABLEAU DE BORD MULTI-CLIENT — Req : rendre "Vue globale", File OCR, =====
// ===== Échéances TVA et Alertes réellement interactifs (pas décoratifs) =====
const TVA_STATUS_META = {
  'a-declarer': { label:'⚠ À déclarer', cls:'s-red' },
  'trimestriel': { label:'Trim.', cls:'s-gray' },
  'a-jour':      { label:'✓ À jour', cls:'s-green' },
  'exonere':     { label:'Exonéré', cls:'s-gray' }
};
let ocrQueue = [
  { id:1, name:'Facture_electricite.pdf', clientId:'C001', received:'reçu il y a 2h' },
  { id:2, name:'Note_frais_juin.jpg',      clientId:'C001', received:'reçu hier' },
  { id:3, name:'Facture_ciment.pdf',       clientId:'C001', received:'reçu il y a 2 jours' },
  { id:4, name:'Releve_CIH_mai.pdf',       clientId:'C003', received:'reçu hier' },
  { id:5, name:'Facture_transport.pdf',    clientId:'C003', received:'reçu il y a 2 jours' },
  { id:6, name:'Facture_fournisseur.jpg',  clientId:'C004', received:'reçu hier' },
  { id:7, name:'Contrat_bail.pdf',         clientId:'C008', received:'reçu il y a 3 jours' },
  { id:8, name:'Releve_bancaire.pdf',      clientId:'C009', received:'reçu il y a 3 jours' }
];
let ocrShowAll = false;
let currentOcrDocId = null;
function docsPendingFor(clientId) { return ocrQueue.filter(o => o.clientId === clientId).length; }
function clientShortName(id) {
  const d = DATA.dossiers.find(x => x.id === id);
  return d ? d.name.replace(/^(SARL|SA|STE)\s+/i, '') : id;
}

function renderHomeKPIs() {
  const total = DATA.dossiers.length;
  const actifs = DATA.dossiers.filter(d => d.status === 'actif').length;
  const enCloture = DATA.dossiers.filter(d => d.status === 'en-cours').length;
  const tvaADeclarer = DATA.dossiers.filter(d => tvaStatusFor(d) === 'a-declarer').length;
  const erreurs = DATA.dossiers.filter(d => d.balanceStatus === 'erreur').length;
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('kpi-clients-actifs', actifs);
  setTxt('kpi-clients-sub', actifs + ' actifs sur ' + total);
  setTxt('kpi-docs-pending', ocrQueue.length);
  setTxt('kpi-tva-declarer', tvaADeclarer);
  setTxt('kpi-erreurs-balance', erreurs);
  setTxt('kpi-exercices-cloture', enCloture);
}

function filterHomeClients(val) {
  const sel = document.getElementById('home-clients-filter');
  if (sel) sel.value = val;
  renderHomeClientsTable();
  document.getElementById('home-clients-card')?.scrollIntoView({ behavior:'smooth', block:'start' });
}
function renderHomeClientsTable() {
  const q = (document.getElementById('home-clients-search')?.value || '').trim().toLowerCase();
  const filter = document.getElementById('home-clients-filter')?.value || '';
  let list = DATA.dossiers.filter(d => !q || d.name.toLowerCase().includes(q) || d.ice.includes(q));
  if (filter === 'erreur') list = list.filter(d => d.balanceStatus === 'erreur');
  else if (filter === 'a-declarer') list = list.filter(d => tvaStatusFor(d) === 'a-declarer');
  else if (filter === 'docs') list = list.filter(d => docsPendingFor(d.id) > 0);
  else if (filter === 'en-cours') list = list.filter(d => d.status === 'en-cours');
  const LIMIT = 6;
  const tb = document.getElementById('home-clients-body');
  if (!list.length) {
    tb.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:18px;">Aucun client ne correspond à ce filtre.</td></tr>`;
  } else {
    tb.innerHTML = list.slice(0, LIMIT).map(d => {
      const docs = docsPendingFor(d.id);
      const docsBadge = docs === 0 ? { label:'✓ À jour', cls:'s-green' } : { label: docs + (docs > 1 ? ' docs' : ' doc'), cls:'s-yellow' };
      const tva = TVA_STATUS_META[tvaStatusFor(d)];
      const bal = d.balanceStatus === 'erreur' ? { label:'⚠ Erreur', cls:'s-red' } : { label:'✓ OK', cls:'s-green' };
      const stats = computeQuickStatsFor(d.id, d.exercice);
      const tresorerie = stats.nbEntries > 0 ? stats.banque : (d.demoTresorerie || 0);
      const isCurrent = d.id === currentClientId;
      const rowBg = d.balanceStatus === 'erreur' ? 'background:#FFF5F5;' : (d.status === 'en-cours' ? 'background:#FFFBEB;' : '');
      const regime = `${d.tva_periodicite === 'Mensuelle' ? 'Mensuel' : d.tva_periodicite === 'Trimestrielle' ? 'Trim.' : d.tva_periodicite} / ${d.tva_regime === 'Encaissement' ? 'Enc.' : d.tva_regime === 'Débit' ? 'Débit' : d.tva_regime}`;
      return `<tr style="${rowBg}">
        <td><strong>${d.name}</strong>${isCurrent ? ' <span class="badge" style="font-size:9px;">Dossier ouvert</span>' : ''}</td>
        <td>${d.exercice}</td>
        <td>${regime}</td>
        <td style="text-align:center;"><span class="status ${docsBadge.cls}">${docsBadge.label}</span></td>
        <td style="text-align:center;"><span class="status ${tva.cls}">${tva.label}</span></td>
        <td style="text-align:right;color:${tresorerie >= 15000 ? 'var(--success)' : 'var(--warning)'};">${fmtFR(Math.abs(tresorerie))} MAD</td>
        <td style="text-align:center;"><span class="status ${bal.cls}">${bal.label}</span></td>
        <td>${isCurrent ? '<span style="font-size:11px;color:var(--muted);">— en cours —</span>' : `<button class="btn btn-s btn-xs" data-action="previewClientById('${d.id}')">Ouvrir</button>`}</td>
      </tr>`;
    }).join('');
  }
  const moreBtn = document.getElementById('home-clients-more');
  if (moreBtn) moreBtn.style.display = list.length > LIMIT ? '' : 'none';
}

function renderOcrQueue() {
  const wrap = document.getElementById('ocr-queue-list');
  if (!wrap) return;
  const list = ocrShowAll ? ocrQueue : ocrQueue.slice(0, 3);
  wrap.innerHTML = list.length ? list.map(o => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-bottom:1px solid var(--border);font-size:12px;">
      <div><div style="font-weight:600;">${o.name}</div><div style="font-size:11px;color:var(--muted);">${clientShortName(o.clientId)} — ${o.received}</div></div>
      <button class="btn btn-s btn-xs" data-action="traiterOcrDoc(${o.id})">Traiter</button>
    </div>`).join('') : `<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">✓ File OCR vide — tous les documents sont traités.</div>`;
  const moreCount = ocrQueue.length - 3;
  const moreEl = document.getElementById('ocr-more-btn');
  if (moreEl) {
    if (moreCount > 0 && !ocrShowAll) { moreEl.style.display = ''; moreEl.textContent = `+ ${moreCount} autres documents`; }
    else moreEl.style.display = 'none';
  }
  const badge = document.getElementById('ocr-queue-badge');
  if (badge) badge.textContent = ocrQueue.length + (ocrQueue.length > 1 ? ' documents' : ' document');
}
function toggleOcrShowAll() { ocrShowAll = true; renderOcrQueue(); }
function traiterOcrDoc(id) {
  currentOcrDocId = id;
  const doc = ocrQueue.find(o => o.id === id);
  if (doc) showToast('Ouverture de ' + doc.name + '...', 'info');
  openModal('modalOCR');
}

function renderTvaDeadlinesWidget() {
  const wrap = document.getElementById('tva-deadlines-list');
  if (!wrap) return;
  const items = DATA.dossiers.map(d => ({ d, info: computeTvaDeadline(d.tva_periodicite) }))
    .filter(x => x.info)
    .sort((a, b) => a.info.days - b.info.days)
    .slice(0, 4);
  wrap.innerHTML = items.map(({ d, info }) => {
    const urgent = info.days <= 7, soon = info.days <= 30;
    const badge = urgent ? { label:'Urgent', cls:'s-red' } : soon ? { label:'À faire', cls:'s-yellow' } : { label:'OK', cls:'s-green' };
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-bottom:1px solid var(--border);font-size:12px;cursor:pointer;" data-action="previewClientById('${d.id}')">
      <div><div style="font-weight:600;">${d.name}</div><div style="font-size:11px;color:${urgent ? 'var(--danger)' : 'var(--muted)'};">${d.tva_periodicite} — échéance ${info.dstr} — dans ${info.days} jour${info.days > 1 ? 's' : ''}</div></div>
      <span class="status ${badge.cls}">${badge.label}</span>
    </div>`;
  }).join('') || `<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px;">Aucune échéance TVA à venir.</div>`;
}

function renderHomeDashboard() {
  renderHomeKPIs();
  renderHomeClientsTable();
  renderOcrQueue();
  renderTvaDeadlinesWidget();
}

// ===== TOASTS =====
function showToast(message, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = message;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

// ===== KOMPTA TAX ENGINE: SIMPL-TVA EXPORT =====
// Builds the "Relevé des Déductions" payload from this year's ACHATS
// (purchase) entries carrying a "TVA récupérable" line (account 3455...).
// Sales-side TVA (445520...) isn't part of this déductions statement.
function buildReleveDeductionsPayload(clientId = currentClientId, includeAllYears = false) {
  const dossier = DATA.dossiers.find(x => x.id === clientId);
  if (!dossier) return null;
  const data = DATA.clientData[clientId] || { journal_entries: [] };
  const entries = (data.journal_entries || []).filter(e => includeAllYears || e.year === currentYear);
  const lines = [];
  let ord = 1;

  entries.forEach(e => {
    const tvaLine = e.lines.find(l => isAccount(l.compte, CGNC.TVA_RECUPERABLE));
    if (!tvaLine) return;
    const htLine = e.lines.find(l => isAccount(l.compte, CGNC.CHARGES));
    const ttcLine = e.lines.find(l => l !== tvaLine && /^(34|44)/.test(String(l.compte)));
    if (!htLine || !ttcLine) return;

    const supplier = auxiliaryContact(ttcLine.auxiliaire, clientId);
    const dateFacture = `${e.year}-${String(e.mois).padStart(2, '0')}-${String(e.jour).padStart(2, '0')}`;

    lines.push({
      ord: ord++,
      numFacture: e.n_facture || e.piece,
      designation: htLine.libelle || e.libelle,
      fournisseur: supplier?.libelle || '',
      montantHT: htLine.montant,
      tauxTVA: tvaLine.tva || 20,
      montantTVA: tvaLine.montant,
      montantTTC: ttcLine.montant,
      ice: supplier?.ice || null,
      identifiantFiscal: supplier?.identifiant_fiscal || null,
      // Kompta doesn't track a separate payment method/date per invoice yet
      // (that lives in the Bank Reconciliation module, not yet wired) — these
      // are placeholders until that data is captured at entry time.
      modePaiement: 'VIREMENT',
      datePaiement: dateFacture,
      dateFacture: dateFacture,
      prorata: 100
    });
  });

  return {
    // Dossier profiles currently only store `ice`, not a separate 8-digit
    // `identifiant_fiscal` for the declaring company — placeholder until
    // that field is added to the dossier setup screen.
    ice_declarant: dossier.ice,
    if_declarant: dossier.identifiant_fiscal || '00000000',
    periode: String(currentYear),
    lines,
    demoOnly: true
  };
}

function buildTvaCollecteePayload(clientId = currentClientId, includeAllYears = false) {
  const entries = (DATA.clientData[clientId]?.journal_entries || [])
    .filter(e => (includeAllYears || e.year === currentYear) && e.journal === 'VENTES');
  const lines = [];
  let ord = 1;

  entries.forEach(e => {
    const tvaLine = e.lines.find(l => isAccount(l.compte, CGNC.TVA_FACTUREE));
    const htLine = e.lines.find(l => isAccount(l.compte, CGNC.PRODUITS));
    const clientLine = e.lines.find(l => isAccount(l.compte, CGNC.CLIENTS));
    if (!tvaLine || !htLine || !clientLine) return;

    const client = auxiliaryContact(clientLine.auxiliaire, clientId);
    const dateFacture = `${e.year}-${String(e.mois).padStart(2, '0')}-${String(e.jour).padStart(2, '0')}`;
    lines.push({
      ord: ord++,
      numFacture: e.n_facture || e.piece,
      dateFacture: dateFacture,
      client: client?.libelle || clientLine.libelle || '',
      identifiantFiscal: client?.identifiant_fiscal || null,
      ice: client?.ice || null,
      montantHT: Math.abs(htLine.montant || 0),
      tauxTVA: tvaLine.tva || 20,
      montantTVA: Math.abs(tvaLine.montant || 0),
      montantTTC: Math.abs(clientLine.montant || 0)
    });
  });

  return lines;
}

async function responseErrorMessage(response, fallback) {
    try {
      const body = await response.json();
      const detail = body?.detail;
      if (typeof detail === 'string') return detail;
      if (detail?.message) {
        const diagnostics = detail.diagnostics?.map(item => item.message).filter(Boolean) || [];
        return [detail.message, ...diagnostics].join(' — ');
      }
      if (Array.isArray(detail)) {
        const messages = detail.map(item => item.msg || item.message).filter(Boolean);
        if (messages.length) return messages.join(' ; ');
      }
    } catch (error) {
      // Keep the status fallback when the server did not return JSON.
    }
    return `${fallback} (HTTP ${response.status}).`;
  }

async function exportSimplTva() {
  const payload = buildReleveDeductionsPayload();
  if (!payload || !payload.lines.length) {
    showToast('Aucune ligne de TVA déductible (achats) trouvée pour cet exercice.', 'error');
    return;
  }

  try {
    const res = await apiFetch(`${KOMPTA_API_BASE}/api/exports/simpl-tva`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `SIMPL_TVA_${currentYear}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      closeModal('modalTVA');
      showToast('Archive SIMPL-TVA exportée.', 'success');
      return;
    }

    if (res.status === 422) {
      const body = await res.json();
      showExportErrors(body.detail);
      return;
    }

    showToast(await responseErrorMessage(res, 'Échec de l’export SIMPL-TVA.'), 'error');
  } catch (err) {
    showToast(apiConnectionErrorMessage(err, 'Export SIMPL-TVA'), 'error');
  }
}

async function exportTvaExcel() {
  const dossier = DATA.dossiers.find(x => x.id === currentClientId);
  if (!dossier) {
    showToast('Dossier client actif introuvable.', 'error');
    return;
  }

  const releve = buildReleveDeductionsPayload(currentClientId, false);
  const request = {
    dossierId: currentClientId,
    companyName: dossier?.name || 'Entreprise',
    regime: dossier?.tva_regime || 'Débit',
    tvaCollectee: parseAmount(document.getElementById('tva-facturee')?.textContent),
    ventes: buildTvaCollecteePayload(currentClientId, false),
    releve
  };

  try {
    const res = await apiFetch(`${KOMPTA_API_BASE}/export-tva-excel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    if (!res.ok) {
      showToast(await responseErrorMessage(res, 'Échec de l’export Excel TVA.'), 'error');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = dossierFileName(`TVA_${currentYear}.xlsx`);
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
    closeModal('modalTVA');
    showToast('Synthèse TVA exportée en Excel.', 'success');
  } catch (err) {
    showToast(apiConnectionErrorMessage(err, 'Export Excel TVA'), 'error');
  }
}

function portfolioClientPayload(dossier) {
  const clientId = dossier.id;
  const entries = DATA.clientData[clientId]?.journal_entries || [];
  const purchases = [];
  const ventes = [];
  let purchaseOrd = 1;
  let salesOrd = 1;

  entries.forEach(e => {
    const dateFacture = `${e.year}-${String(e.mois).padStart(2, '0')}-${String(e.jour).padStart(2, '0')}`;
    if (e.journal === 'ACHATS') {
      const tvaLine = e.lines.find(l => isAccount(l.compte, CGNC.TVA_RECUPERABLE));
      const htLine = e.lines.find(l => isAccount(l.compte, CGNC.CHARGES));
      const supplierLine = e.lines.find(l => isAccount(l.compte, CGNC.FOURNISSEURS));
      if (tvaLine && htLine && supplierLine) {
        const supplier = auxiliaryContact(supplierLine.auxiliaire, dossier.id);
        purchases.push({
          companyName: dossier.name,
          ord: purchaseOrd++,
          numFacture: e.n_facture || e.piece,
          designation: htLine.libelle || e.libelle || '',
          fournisseur: supplier?.libelle || supplierLine.libelle || '',
          identifiantFiscal: supplier?.identifiant_fiscal || '',
          ice: supplier?.ice || '',
          montantHT: Math.abs(htLine.montant || 0),
          tauxTVA: tvaLine.tva || 20,
          montantTVA: Math.abs(tvaLine.montant || 0),
          montantTTC: Math.abs(supplierLine.montant || 0),
          modePaiement: 'VIREMENT',
          dateFacture,
          datePaiement: dateFacture,
          prorata: 100
        });
      }
    }
    if (e.journal === 'VENTES') {
      const tvaLine = e.lines.find(l => isAccount(l.compte, CGNC.TVA_FACTUREE));
      const htLine = e.lines.find(l => isAccount(l.compte, CGNC.PRODUITS));
      const clientLine = e.lines.find(l => isAccount(l.compte, CGNC.CLIENTS));
      if (tvaLine && htLine && clientLine) {
        const client = auxiliaryContact(clientLine.auxiliaire, dossier.id);
        ventes.push({
          ord: salesOrd++,
          numFacture: e.n_facture || e.piece,
          dateFacture: dateFacture,
          client: client?.libelle || clientLine.libelle || '',
          identifiantFiscal: /^\d{8}$/.test(client?.identifiant_fiscal || '') ? client.identifiant_fiscal : null,
          ice: /^\d{15}$/.test(client?.ice || '') ? client.ice : null,
          montantHT: Math.abs(htLine.montant || 0),
          tauxTVA: tvaLine.tva || 20,
          montantTVA: Math.abs(tvaLine.montant || 0),
          montantTTC: Math.abs(clientLine.montant || 0)
        });
      }
    }
  });

  return {
    companyName: dossier.name,
    ifClient: dossier.identifiant_fiscal || '',
    iceClient: dossier.ice || '',
    regime: dossier.tva_regime || 'Débit',
    creditAnterieur: 0,
    ventes,
    achats: purchases
  };
}

async function exportPortfolioTvaExcel() {
  const request = { clients: DATA.dossiers.map(portfolioClientPayload) };
  try {
    const res = await apiFetch(`${KOMPTA_API_BASE}/export-portfolio-tva-excel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    if (!res.ok) {
      showToast(await responseErrorMessage(res, 'Échec de l’export portefeuille TVA.'), 'error');
      return;
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="?([^";]+)"?/);
    const filename = match ? match[1] : 'Recapitulatif_TVA_Portefeuille.xlsx';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
    showToast('Récapitulatif TVA portefeuille exporté en Excel.', 'success');
  } catch (err) {
    showToast(apiConnectionErrorMessage(err, 'Export Excel portefeuille'), 'error');
  }
}

function showExportErrors(detail) {
  const list = document.getElementById('export-errors-list');
  if (!list) { showToast('Des erreurs de validation ont été détectées.', 'error'); return; }

  let issues = [];
  if (Array.isArray(detail)) {
    // Raw FastAPI/pydantic request-body validation errors (e.g. malformed
    // ICE/IF format caught before our own business rules even run).
    issues = detail.map(e => ({
      label: 'FORMAT',
      line: (e.loc || []).includes('lines') ? e.loc[e.loc.indexOf('lines') + 1] + 1 : null,
      message: e.msg,
      field: (e.loc || []).slice(-1)[0]
    }));
  } else {
    // Our own ExportOutcome shape: business rule + XSD diagnostics.
    const businessIssues = (detail?.business_validation?.issues || []).map(i => ({
      label: i.severity, line: i.line, message: i.message, field: i.field
    }));
    const xsdIssues = (detail?.xsd_validation?.diagnostics || []).map(d => ({
      label: 'STRUCTURE', line: d.line, message: d.message, field: d.path
    }));
    issues = [...businessIssues, ...xsdIssues];
  }

  list.innerHTML = issues.length
    ? issues.map(i => `
        <div style="padding:8px 10px;border-left:3px solid var(--danger);background:#FEF2F2;border-radius:4px;margin-bottom:6px;font-size:12px;">
          <strong>${i.label || 'ERREUR'}${i.line ? ' — Ligne ' + i.line : ''}</strong><br>
          ${i.message}${i.field ? ' <span style="color:var(--muted);">(' + i.field + ')</span>' : ''}
        </div>`).join('')
    : '<p style="color:var(--muted);">Erreur de validation sans détail disponible.</p>';

  openModal('modalExportErrors');
}

// ===== SAISIE WIRING =====
function suggestPiece() {
  const jname = document.getElementById('saisie-journal').value;
  if (jname === 'AUDIT') return;
  const prefix = journalPrefix(jname);
  let max = 0;
  clientEntries().forEach(e => {
    if (e.journal === jname && e.year === currentYear) {
      const m = String(e.piece).match(/(\d+)\s*$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  });
  const next = String(max + 1).padStart(3, '0');
  document.getElementById('saisie-piece').value = prefix + '-' + next;
}

let prevHeaderLib = '';
function mirrorLibelle() {
  const val = document.getElementById('saisie-libelle').value;
  document.querySelectorAll('#lines-body tr').forEach(row => {
    // Only mirror into cells that are empty or still match the previous header
    // value, so manually-edited line labels are preserved.
    if (!row.dataset.lineLabel || row.dataset.lineLabel === prevHeaderLib) {
      row.dataset.lineLabel = val;
    }
  });
  prevHeaderLib = val;
}

let activeSaisieJournal = null;
let activeJournalDraftId = null;

function firstAuxiliaryAccount(root) {
  return activeAuxiliaryAccounts().find(account => account.compte_racine === root)?.compte_auxiliaire || '';
}

function setEntryRow(row, { account, auxiliary = '', label, side, amount = '', rate = '0', fixed = false }) {
  const accountInput = row.querySelector('.account-cell');
  const intituleInput = row.querySelector('.intitule-cell');
  accountInput.value = account;
  accountInput.readOnly = fixed;
  accountInput.dataset.fixedAccount = fixed ? 'true' : '';
  accountInput.dataset.auxiliaryCode = auxiliary;
  accountInput.dataset.tierAccount = [CGNC.CLIENTS, CGNC.FOURNISSEURS].includes(account) ? 'true' : '';
  accountInput.dataset.templateCode = '';
  const officialLabel = ACCOUNTS[account] || getAccountByCode(account)?.label || '';
  intituleInput.value = officialLabel;
  intituleInput.readOnly = true;
  intituleInput.dataset.accountCode = account;
  row.dataset.lineLabel = label || document.getElementById('saisie-libelle')?.value || '';
  row.dataset.vatRate = rate;
  row.dataset.defaultSide = side;
  const debit = row.querySelector('.debit-input');
  const credit = row.querySelector('.credit-input');
  row.dataset.fixedSide = fixed ? side : '';
  debit.value = side === 'D' ? amount : '';
  credit.value = side === 'C' ? amount : '';
  debit.disabled = fixed ? side !== 'D' : side === 'C' && Boolean(amount);
  credit.disabled = fixed ? side !== 'C' : side === 'D' && Boolean(amount);
  updateEntryRowIndentation(row);
  updateGeneralAccountStyle(accountInput);
}

function updateEntryRowIndentation(row) {
  const debit = parseAmount(row.querySelector('.debit-input')?.value);
  const credit = parseAmount(row.querySelector('.credit-input')?.value);
  row.classList.toggle('entry-credit-line', credit > 0 && debit === 0);
}

function configureJournalForm(reset = true) {
  const journal = document.getElementById('saisie-journal')?.value;
  const operationControl = document.getElementById('saisie-operation-control');
  const amountTypeControl = document.getElementById('saisie-amount-type-control');
  const vatRateControl = document.getElementById('saisie-vat-rate-control');
  const calcButton = document.querySelector('[data-action="calcHtTva()"]');
  const operation = document.getElementById('saisie-operation')?.value || 'RECEIPT';
  const hasOperation = journal === 'BANQUE' || journal === 'CAISSE';
  const hasVatTemplate = journal === 'VENTES' || journal === 'ACHATS';
  if (operationControl) operationControl.style.display = hasOperation ? '' : 'none';
  if (amountTypeControl) amountTypeControl.style.display = hasVatTemplate ? '' : 'none';
  if (vatRateControl) vatRateControl.style.display = hasVatTemplate ? '' : 'none';
  if (calcButton) calcButton.style.display = hasVatTemplate ? '' : 'none';
  const operationSelect = document.getElementById('saisie-operation');
  if (operationSelect) {
    operationSelect.options[0].textContent = journal === 'CAISSE' ? 'Encaissement' : 'Règlement client reçu';
    operationSelect.options[1].textContent = journal === 'CAISSE' ? 'Décaissement' : 'Paiement fournisseur / Décaissement';
  }
  const referenceLabel = document.getElementById('saisie-ref-label');
  if (referenceLabel) {
    referenceLabel.textContent = journal === 'BANQUE' ? 'Référence / Mode de règlement *'
      : journal === 'ACHATS' ? 'N° Facture Fournisseur *' : 'Référence';
  }
  if (!reset) return;
  const body = document.getElementById('lines-body');
  if (!body) return;
  body.innerHTML = '';
  activeJournalDraftId = null;
  document.getElementById('saisie-ref').value = '';
  if (journal === 'BANQUE' || journal === 'CAISSE') {
    const fixedAccount = journal === 'BANQUE' ? '5141' : '5161';
    const fixedLabel = journal === 'BANQUE' ? 'Banque' : 'Caisse';
    const isReceipt = operation === 'RECEIPT';
    const fixedSide = isReceipt ? 'D' : 'C';
    const counterpartyRoot = isReceipt ? '3421' : '4411';
    const counterpartySide = isReceipt ? 'C' : 'D';
    const fixedRow = addLine();
    const counterparty = addLine();
    const auxiliary = firstAuxiliaryAccount(counterpartyRoot);
    setEntryRow(counterparty, {
      account:counterpartyRoot, auxiliary,
      label:auxiliaryContact(auxiliary)?.libelle || (isReceipt ? 'Client' : 'Fournisseur'),
      side:counterpartySide
    });
    setEntryRow(fixedRow, { account:fixedAccount, label:fixedLabel, side:fixedSide, fixed:true });
    if (!isReceipt) {
      body.append(counterparty, fixedRow);
    }
    return;
  }

  if (journal === 'OD') {
    addLine();
    addLine();
    return;
  }

  const rows = [addLine(), addLine(), addLine()];
  if (journal === 'VENTES') {
    const customer = firstAuxiliaryAccount('3421');
    setEntryRow(rows[0], { account:'3421', auxiliary:customer, label:auxiliaryContact(customer)?.libelle || 'Client', side:'D', fixed:true });
    setEntryRow(rows[1], { account:'7111', label:ACCOUNTS['7111'] || 'Ventes de marchandises', side:'C', rate:'20' });
    setEntryRow(rows[2], { account:'4455', label:ACCOUNTS['4455'] || 'État TVA facturée', side:'C' });
  } else {
    setEntryRow(rows[0], { account:'6111', label:ACCOUNTS['6111'] || 'Achats de marchandises', side:'D', rate:'20' });
    setEntryRow(rows[1], { account:'34552', label:ACCOUNTS['34552'] || 'État TVA récupérable sur charges', side:'D' });
    const supplier = firstAuxiliaryAccount('4411');
    setEntryRow(rows[2], { account:'4411', auxiliary:supplier, label:auxiliaryContact(supplier)?.libelle || 'Fournisseur', side:'C', fixed:true });
  }
  computeTotals();
}

// Account lookup and autocomplete share the existing account popup.
let popupTargetInput = null;
const accountSearchTokens = new WeakMap();
let accountSearchErrorShown = false;
function lookupAccount(input) {
  const code = input.value.trim();
  const tr = input.closest('tr');
  const intituleCell = tr.querySelector('.intitule-cell');
  if (input.dataset.fixedAccount === 'true') {
    input.classList.remove('acct-error');
    const officialLabel = ACCOUNTS[code] || getAccountByCode(code)?.label || '';
    if (intituleCell) intituleCell.value = officialLabel;
    hideAcctPopup();
    return;
  }
  if (!code) { input.classList.remove('acct-error'); if (intituleCell) intituleCell.value = ''; hideAcctPopup(); return; }
  if (input.readOnly && input.dataset.pcmSelected === 'true' && code !== '4411') {
    hideAcctPopup();
    return;
  }
  // Tier accounts select a contact from the separate auxiliary ledger.
  if ([CGNC.CLIENTS, CGNC.FOURNISSEURS].includes(code)) {
    input.classList.remove('acct-error');
    input.dataset.tierAccount = 'true';
    if (intituleCell) intituleCell.value = ACCOUNTS[code] || getAccountByCode(code)?.label || '';
    showAcctPopup(input);
    return;
  }
  hideAcctPopup();
  if (CGNC_CODES.has(code) && ACCOUNTS[code]) {
    input.classList.remove('acct-error');
    if (intituleCell) intituleCell.value = ACCOUNTS[code];
  } else {
    if (intituleCell) intituleCell.value = '';
    input.classList.add('acct-error');
  }
}

function showAcctPopup(input) {
  popupTargetInput = input;
  const pop = document.getElementById('acct-popup');
  const root = input.value.trim().slice(0, 4);
  const parties = activeAuxiliaryAccounts().filter(account => account.compte_racine === root);
  document.querySelector('#acct-popup .ap-head').textContent = `${root === '3421' ? 'Clients' : 'Fournisseurs'} divisionnaires — sélectionnez un tiers`;
  const body = document.getElementById('acct-popup-body');
  body.innerHTML = '';
  parties.forEach(s => {
    const div = document.createElement('div');
    div.className = 'ap-item';
    const code = document.createElement('div');
    code.className = 'ap-code';
    code.textContent = `${s.compte_auxiliaire} — ${s.libelle}`;
    const details = document.createElement('div');
    details.className = 'ap-sub';
    details.textContent = `ICE: ${s.ice || '—'} · IF: ${s.identifiant_fiscal || '—'} · ${s.type_tiers || ''}`;
    div.append(code, details);
    div.onmousedown = event => event.preventDefault();
    div.onclick = () => selectSupplier(s);
    body.appendChild(div);
  });
  if (!parties.length) {
    const empty = document.createElement('div');
    empty.className = 'ap-item';
    empty.textContent = 'Aucun tiers auxiliaire importé pour ce dossier.';
    body.appendChild(empty);
  }
  const r = input.getBoundingClientRect();
  pop.style.left = (r.left + window.scrollX) + 'px';
  pop.style.top = (r.bottom + window.scrollY + 2) + 'px';
  pop.style.display = 'block';
}
async function searchPcmAccounts(input) {
  const query = input.value.trim();
  const token = (accountSearchTokens.get(input) || 0) + 1;
  accountSearchTokens.set(input, token);
  if (!query) {
    if (popupTargetInput === input) hideAcctPopup();
    return;
  }
  try {
    const params = new URLSearchParams({ q: query, limit: '10' });
    const response = await apiFetch(`${KOMPTA_API_BASE}/api/accounts/pcge-general/search?${params}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.detail?.message || 'Recherche PCGE impossible.');
    if (accountSearchTokens.get(input) !== token || input.value.trim() !== query || document.activeElement !== input) return;
    showPcmAccountSuggestions(input, result);
  } catch (error) {
    if (accountSearchTokens.get(input) !== token) return;
    if (!accountSearchErrorShown) {
      showToast(apiConnectionErrorMessage(error, 'Recherche dans le plan comptable'), 'error');
      accountSearchErrorShown = true;
      window.setTimeout(() => { accountSearchErrorShown = false; }, 5000);
    }
  }
}
function showPcmAccountSuggestions(input, accounts) {
  const pop = document.getElementById('acct-popup');
  const body = document.getElementById('acct-popup-body');
  popupTargetInput = input;
  document.querySelector('#acct-popup .ap-head').textContent = 'Plan comptable marocain — sélectionnez un compte';
  body.innerHTML = '';
  const selectableAccounts = accounts.filter(account => CGNC_CODES.has(account.code) && /^\d{4,5}$/.test(account.code));
  selectableAccounts.forEach(account => {
    const item = document.createElement('div');
    item.className = 'ap-item';
    const codeLabel = document.createElement('div');
    codeLabel.className = 'ap-code';
    codeLabel.textContent = `${account.code} - ${account.label}`;
    const detail = document.createElement('div');
    detail.className = 'ap-sub';
    detail.textContent = `Classe ${account.class}`;
    item.append(codeLabel, detail);
    item.onmousedown = event => event.preventDefault();
    item.onclick = () => selectPcmAccount(account);
    body.appendChild(item);
  });
  if (!selectableAccounts.length) {
    const empty = document.createElement('div');
    empty.className = 'ap-item';
    empty.textContent = 'Aucun compte correspondant.';
    body.appendChild(empty);
  }
  const bounds = input.getBoundingClientRect();
  pop.style.left = (bounds.left + window.scrollX) + 'px';
  pop.style.top = (bounds.bottom + window.scrollY + 2) + 'px';
  pop.style.display = 'block';
}
function selectPcmAccount(account) {
  const input = popupTargetInput;
  if (!input) return;
  input.value = account.code;
  input.readOnly = true;
  input.dataset.pcmSelected = 'true';
  input.dataset.tierAccount = [CGNC.CLIENTS, CGNC.FOURNISSEURS].includes(account.code) ? 'true' : '';
  input.title = 'Compte sélectionné — appuyez sur Retour arrière pour le modifier';
  input.classList.remove('acct-error');
  const row = input.closest('tr');
  const intituleCell = row.querySelector('.intitule-cell');
  if (intituleCell) intituleCell.value = account.label;
  hideAcctPopup();
  updateGeneralAccountStyle(input);
  computeTotals();
}
function hideAcctPopup() {
  const pop = document.getElementById('acct-popup');
  if (pop) pop.style.display = 'none';
  const heading = document.querySelector('#acct-popup .ap-head');
  if (heading) heading.textContent = 'Comptes divisionnaires — sélectionnez un tiers';
  popupTargetInput = null;
}
function selectSupplier(s) {
  if (popupTargetInput) {
    const row = popupTargetInput.closest('tr');
    if (row && (!row.dataset.lineLabel || ['Client', 'Clients', 'Fournisseur', 'Fournisseurs'].includes(row.dataset.lineLabel))) {
      row.dataset.lineLabel = s.libelle;
    }
    popupTargetInput.dataset.auxiliaryCode = s.compte_auxiliaire;
    delete popupTargetInput.dataset.pcmSelected;
    popupTargetInput.title = '';
    popupTargetInput.classList.remove('acct-error');
    popupTargetInput.dataset.auxiliaryLabel = s.libelle;
    const intituleCell = row?.querySelector('.intitule-cell');
    if (intituleCell) intituleCell.value = ACCOUNTS[popupTargetInput.value.trim()] || getAccountByCode(popupTargetInput.value.trim())?.label || '';
  }
  hideAcctPopup();
  computeTotals();
}
// Close popup when clicking elsewhere
document.addEventListener('mousedown', e => {
  const pop = document.getElementById('acct-popup');
  if (pop && pop.style.display === 'block' && !pop.contains(e.target) && e.target !== popupTargetInput) {
    hideAcctPopup();
  }
});
document.addEventListener('keydown', event => {
  const input = event.target.closest?.('#lines-body .account-cell');
  if (!input || !input.readOnly || event.key !== 'Backspace') return;
  if (input.dataset.fixedAccount === 'true') return;
  event.preventDefault();
  input.readOnly = false;
  delete input.dataset.pcmSelected;
  input.title = '';
  input.value = '';
  input.focus();
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

// Track which account row is focused (for the "Compte" totals).
let focusedAccount = '';
let activeEntryRow = null;
function setFocusedAccount(tr, input) {
  const acct = input || tr.querySelector('.account-cell');
  focusedAccount = acct ? acct.value.trim() : '';
  activeEntryRow = tr;
  computeTotals();
}

function computeTotals() {
  let jd = 0, jc = 0, cd = 0, cc = 0;
  document.querySelectorAll('#lines-body tr').forEach(tr => {
    const account = tr.querySelector('.account-cell')?.value.trim() || '';
    const debit = parseAmount(tr.querySelector('.debit-input')?.value);
    const credit = parseAmount(tr.querySelector('.credit-input')?.value);
    updateEntryRowIndentation(tr);
    jd += debit; jc += credit;
    if (account === focusedAccount) { cd += debit; cc += credit; }
  });
  document.getElementById('j-debit').textContent = fmtFR(jd);
  document.getElementById('j-credit').textContent = fmtFR(jc);
  const totalDebit = jd;
  const totalCredit = jc;
  const rawSolde = totalDebit - totalCredit;
  const solde = Math.abs(rawSolde) < 0.001 ? 0 : rawSolde;
  const el = document.getElementById('total-ecart');
  el.textContent = solde === 0
    ? '0'
    : `${fmtFR(Math.abs(solde))} ${solde > 0 ? 'Débiteur' : 'Créditeur'}`;
  el.className = solde === 0 ? 'tv balanced' : 'tv unbalanced';
  const cashBalance = round2(cashOpeningBalance() + clientEntries()
    .filter(entry => entry.year === currentYear && entry.serverEntryId)
    .flatMap(entry => entry.lines)
    .filter(line => line.compte === '5161')
    .reduce((balance, line) => balance + lineDebit(line) - lineCredit(line), 0));
  const currentCashPayment = document.getElementById('saisie-journal')?.value === 'CAISSE'
    && document.getElementById('saisie-operation')?.value === 'PAYMENT'
    ? [...document.querySelectorAll('#lines-body tr')]
      .filter(row => row.querySelector('.account-cell')?.value.trim() === '5161')
      .reduce((amount, row) => amount + parseAmount(row.querySelector('.credit-input')?.value), 0)
    : 0;
  const cashInsufficient = cashBalance - currentCashPayment < -0.005;
  const cashWarning = document.getElementById('cash-balance-warning');
  if (cashWarning) cashWarning.style.display = cashInsufficient ? '' : 'none';
  updateEntryValidationState(jd, jc, cashInsufficient);
  return { jd, jc };
}

function cashOpeningBalance() {
  return round2(aNouveauxFor(currentYear)
    .filter(account => String(account.code) === '5161')
    .reduce((balance, account) => balance + (account.debit || 0) - (account.credit || 0), 0));
}

document.addEventListener('input', event => {
  if (!event.target.closest('#lines-body')) return;
  if (event.target.matches('.debit-input, .credit-input')) {
    handleAmountInput(event.target);
    updateEntryRowIndentation(event.target.closest('tr'));
  }
  activeEntryRow = event.target.closest('tr');
  computeTotals();
});
document.addEventListener('focusin', event => {
  if (!event.target.closest('#lines-body')) return;
  if (event.target.matches('.debit-input, .credit-input')) {
    amountAtFocus.set(event.target, parseAmount(event.target.value));
  }
  activeEntryRow = event.target.closest('tr');
  computeTotals();
});

function updateEntryValidationState(debit, credit, cashInsufficient = false) {
  const button = document.getElementById('validate-entry');
  if (!button) return;
  const balanced = debit > 0 && Math.abs(debit - credit) < 0.005;
  const journal = document.getElementById('saisie-journal')?.value;
  const referenceRequired = ['BANQUE', 'ACHATS'].includes(journal);
  const referencePresent = !referenceRequired || Boolean(document.getElementById('saisie-ref')?.value.trim());
  const hasFixedAccount = journal === 'BANQUE'
    ? [...document.querySelectorAll('#lines-body .account-cell')].filter(input => input.value.trim() === '5141').length === 1
    : journal === 'CAISSE'
      ? [...document.querySelectorAll('#lines-body .account-cell')].filter(input => input.value.trim() === '5161').length === 1
      : true;
  button.disabled = !balanced || !referencePresent || !hasFixedAccount || cashInsufficient;
  button.title = !balanced ? 'Le total débit doit être égal au total crédit'
    : !referencePresent ? 'Une référence / facture est obligatoire'
      : cashInsufficient ? 'Solde de caisse insuffisant' : '';
}

function renumberLines() {
  document.querySelectorAll('#lines-body tr').forEach((tr, i) => {
    tr.dataset.lineNumber = String(i + 1);
  });
}

function removeLine(btn) {
  btn.closest('tr').remove();
  renumberLines();
  computeTotals();
}

function handleAmountInput(input) {
  const row = input.closest('tr');
  if (!row) return;
  const debit = row.querySelector('.debit-input');
  const credit = row.querySelector('.credit-input');
  if (!debit || !credit) return;
  if (input.value.trim() === '') {
    const fixedSide = row.dataset.fixedSide;
    debit.disabled = fixedSide ? fixedSide !== 'D' : false;
    credit.disabled = fixedSide ? fixedSide !== 'C' : false;
    debit.style.backgroundColor = '';
    credit.style.backgroundColor = '';
    return;
  }
  const opposite = input === debit ? credit : debit;
  opposite.value = '';
  opposite.disabled = true;
  if (row.dataset.fixedSide) {
    const fixedInput = row.querySelector(row.dataset.fixedSide === 'D' ? '.debit-input' : '.credit-input');
    const lockedInput = row.querySelector(row.dataset.fixedSide === 'D' ? '.credit-input' : '.debit-input');
    if (fixedInput) fixedInput.disabled = false;
    if (lockedInput) lockedInput.disabled = true;
  }
  opposite.style.backgroundColor = '#f8fafc';
  input.disabled = false;
  input.style.backgroundColor = '';
}

const amountAtFocus = new WeakMap();
function autoBalanceDebit(input) {
  const row = input.closest('tr');
  const amount = parseAmount(input.value);
  const initialAmount = amountAtFocus.get(input);
  amountAtFocus.delete(input);
  if (!row || amount <= 0 || amount === initialAmount) return;

  const rows = [...row.parentElement.rows];
  let targetRow = rows
    .slice(rows.indexOf(row) + 1)
    .find(candidate =>
      parseAmount(candidate.querySelector('.debit-input')?.value) === 0
      && parseAmount(candidate.querySelector('.credit-input')?.value) === 0
      && candidate.dataset.defaultSide !== 'D'
      && !candidate.querySelector('.credit-input')?.disabled
    );
  if (!targetRow) targetRow = addLine();
  const credit = targetRow.querySelector('.credit-input');
  credit.value = fmtFR(amount);
  handleAmountInput(credit);
  updateEntryRowIndentation(targetRow);
  computeTotals();
}

function removeRow() {
  const body = document.getElementById('lines-body');
  const lastRow = body?.lastElementChild;
  if (!lastRow) return;
  lastRow.remove();
  renumberLines();
  computeTotals();
}

async function validerEcriture() {
  const { jd, jc } = computeTotals();
  if (Math.abs(jd - jc) >= 0.005 || jd === 0) {
    showToast('✗ Écriture déséquilibrée — impossible de valider', 'error');
    return;
  }
  const jname = document.getElementById('saisie-journal').value;
  if (['BANQUE', 'ACHATS'].includes(jname) && !document.getElementById('saisie-ref').value.trim()) {
    showToast(jname === 'BANQUE' ? 'Référence / Mode de règlement obligatoire' : 'N° Facture Fournisseur obligatoire', 'error');
    return;
  }
  if (jname === 'CAISSE' && document.getElementById('cash-balance-warning')?.style.display !== 'none') {
    showToast('Solde de caisse insuffisant', 'error');
    return;
  }
  const dateVal = document.getElementById('saisie-date').value;
  const [, mo, d] = dateVal.split('-');
  const headerFacture = document.getElementById('saisie-ref').value.trim();
  const lines = [];
  const errors = [];
  document.querySelectorAll('#lines-body tr').forEach((tr) => {
    const accountInput = tr.querySelector('.account-cell');
    const enteredAccount = accountInput.value.trim();
    const account = enteredAccount.length > 5 && !CGNC_CODES.has(enteredAccount)
      && isAccount(enteredAccount, CGNC.CLIENTS, CGNC.FOURNISSEURS)
      ? enteredAccount.slice(0, 4) : enteredAccount;
    const lib = tr.dataset.lineLabel || document.getElementById('saisie-libelle').value.trim();
    const debit = parseAmount(tr.querySelector('.debit-input').value);
    const credit = parseAmount(tr.querySelector('.credit-input').value);
    const tva = parseFloat(tr.dataset.vatRate || '0') || 0;
    const isTiers = [CGNC.CLIENTS, CGNC.FOURNISSEURS].includes(account);
    const auxiliary = isTiers
      ? accountInput.dataset.auxiliaryCode || (enteredAccount !== account ? enteredAccount : '')
      : '';
    if (!account && debit === 0 && credit === 0) return;
    if (account && (!/^\d{4,5}$/.test(account) || !CGNC_CODES.has(account))) errors.push(`Compte général absent du référentiel CGNC: ${account}`);
    if (account && !ACCOUNTS[account] && !['3421', '4411', '6111', '3455', '34552', '4455', '7111', '5141', '5161'].includes(account)) errors.push(`Compte inexistant: ${account}`);
    if (isTiers) {
      const known = activeAuxiliaryAccounts().some(a => a.compte_auxiliaire === auxiliary);
      if (!known) errors.push(`Auxiliaire obligatoire et connu pour ${account}`);
    }
    if (account && debit > 0) lines.push({ compte:account, auxiliaire:auxiliary || null, libelle:lib, dbcr:'D', montant:debit, tva });
    if (account && credit > 0) lines.push({ compte:account, auxiliaire:auxiliary || null, libelle:lib, dbcr:'C', montant:credit, tva });
  });
  if (errors.length) { showToast(errors[0], 'error'); return; }
  let response;
  try {
    response = await apiFetch(`${KOMPTA_API_BASE}/api/journal-entries`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ clientId:currentClientId, year:currentYear,
        journal:jname, date:dateVal, pieceNumber:document.getElementById('saisie-piece').value.trim(), reference:headerFacture,
        cashOpeningBalance:cashOpeningBalance(),
        draftId:activeJournalDraftId,
        libelle:document.getElementById('saisie-libelle').value.trim(),
        lines:lines.map(l => ({ compte:l.compte, auxiliaire:l.auxiliaire, libelle:l.libelle,
          debit:l.dbcr === 'D' ? l.montant : 0, credit:l.dbcr === 'C' ? l.montant : 0,
          tva:l.tva })),
        accountCatalog:DATA.accounts.filter(account => account.standard),
        auxiliaryCatalog:activeAuxiliaryAccounts() })
    });
    if (!response.ok) throw new Error(await responseErrorMessage(response, 'Écriture refusée.'));
  } catch (error) {
    const message = error instanceof TypeError
      ? `${apiConnectionErrorMessage(error, 'Enregistrement de l’écriture')} Votre saisie est conservée.`
      : error.message || 'Écriture non enregistrée. Votre saisie est conservée.';
    showToast(message, 'error');
    return;
  }
  const posted = await response.json();
  clientEntries().push({
    serverEntryId:posted.entryId, piece:posted.pieceNumber, journal:jname, jour:d || '', mois:mo || '', year:currentYear,
    libelle:document.getElementById('saisie-libelle').value.trim(),
    n_facture:headerFacture, n_mvt:posted.entryNumber, lines
  });
  clearForm();
  renderAll();
  showToast('✓ Écriture ' + posted.pieceNumber + ' validée et auditée', 'success');
}

function clearForm() {
  document.getElementById('saisie-libelle').value = '';
  document.getElementById('saisie-ref').value = '';
  activeJournalDraftId = null;
  prevHeaderLib = '';
  const tb = document.getElementById('lines-body');
  tb.innerHTML = '';
  addLine();
  addLine();
  suggestPiece();
  computeTotals();
}

async function saveJournalDraft() {
  const journal = document.getElementById('saisie-journal').value;
  if (journal === 'AUDIT') {
    showToast('Le journal Audit est en lecture seule', 'error');
    return;
  }
  const date = document.getElementById('saisie-date').value;
  if (!date) {
    showToast('La date de l’écriture est obligatoire', 'error');
    return;
  }
  const lines = [...document.querySelectorAll('#lines-body tr')].map(row => ({
    compte:row.querySelector('.account-cell').value.trim(),
    auxiliaire:row.querySelector('.account-cell').dataset.auxiliaryCode || '',
    libelle:row.dataset.lineLabel || document.getElementById('saisie-libelle').value.trim(),
    debit:parseAmount(row.querySelector('.debit-input').value),
    credit:parseAmount(row.querySelector('.credit-input').value),
    tva:parseFloat(row.dataset.vatRate || '0') || 0
  }));
  try {
    const response = await apiFetch(`${KOMPTA_API_BASE}/api/journal-drafts`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        draftId:activeJournalDraftId,
        clientId:currentClientId,
        year:currentYear,
        journal,
        date,
        reference:document.getElementById('saisie-ref').value.trim(),
        libelle:document.getElementById('saisie-libelle').value.trim(),
        operation:document.getElementById('saisie-operation')?.value || '',
        lines
      })
    });
    if (!response.ok) throw new Error(await responseErrorMessage(response, 'Brouillon non enregistré.'));
    const saved = await response.json();
    activeJournalDraftId = saved.draftId;
    showToast('Brouillon enregistré dans le journal Audit', 'success');
  } catch (error) {
    showToast(apiConnectionErrorMessage(error, 'Enregistrement du brouillon'), 'error');
  }
}

function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  const map = {home:'🏠 Tableau de bord',saisie:'✏️ Saisie',audit:'📋 Journal Audit',consultation:'📖 Consultation',traitement:'⚙️ Traitements',etats:'📊 États',plancomptable:'📄 Plan Comptable',parametrage:'🔧 Paramètres'};
  document.querySelectorAll('.ni').forEach(n => { if(n.textContent.trim() === map[name]) n.classList.add('active'); });
  if (name === 'saisie') handleSaisieJournalChange();
  if (name === 'audit') renderJournalAudit();
}
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const toggle = document.getElementById('sidebar-toggle');
  if (!sidebar || !toggle) return;
  const collapsed = sidebar.classList.toggle('collapsed');
  toggle.textContent = collapsed ? '▶' : '◀';
  toggle.setAttribute('aria-expanded', String(!collapsed));
}
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.mo').forEach(m => m.addEventListener('click', e => { if(e.target === m) m.classList.remove('open'); }));
function addLine() {
  const tb = document.getElementById('lines-body');
  const tr = document.createElement('tr');
  const entryDate = document.getElementById('saisie-date')?.value || '';
  tr.innerHTML =
    `<td><input type="text" class="account-cell account-general" value="" onblur="lookupAccount(this);updateGeneralAccountStyle(this)" onfocus="focusEntryAccount(this)" oninput="updateGeneralAccountStyle(this);searchPcmAccounts(this)"></td>` +
    `<td><input type="text" class="intitule-cell" value="" readonly tabindex="-1"></td>` +
    `<td><input type="date" class="entry-date-cell" value="${entryDate}"></td>` +
    `<td class="amount-cell"><input type="text" inputmode="decimal" class="debit-input" value="" oninput="computeTotals()" onblur="autoBalanceDebit(this);formatAmountInput(this)"></td>` +
    `<td class="amount-cell"><input type="text" inputmode="decimal" class="credit-input" value="" oninput="computeTotals()" onblur="formatAmountInput(this)"></td>`;
  tb.appendChild(tr);
  computeTotals();
  return tr;
}

function focusEntryAccount(input) {
  setFocusedAccount(input.closest('tr'), input);
  if (input.dataset.tierAccount === 'true') showAcctPopup(input);
}

document.addEventListener('change', event => {
  if (event.target.matches('#saisie-date')) {
    document.querySelectorAll('#lines-body .entry-date-cell').forEach(input => {
      input.value = event.target.value;
    });
  } else if (event.target.matches('#lines-body .entry-date-cell')) {
    const date = event.target.value;
    document.getElementById('saisie-date').value = date;
    document.querySelectorAll('#lines-body .entry-date-cell').forEach(input => {
      input.value = date;
    });
  }
});

// ===== AUTO HT + TVA =====
function calcHtTva() {
  const rows = document.querySelectorAll('#lines-body tr');
  const journal = document.getElementById('saisie-journal').value;
  if (rows.length < 3 || !['VENTES', 'ACHATS'].includes(journal)) return;
  const [clientOrChargeRow, productOrVatRow, vatOrSupplierRow] = rows;
  const taxableRow = journal === 'VENTES' ? productOrVatRow : clientOrChargeRow;
  const entered = parseAmount(taxableRow.querySelector(journal === 'VENTES' ? '.credit-input' : '.debit-input').value);
  const rate = parseFloat(document.getElementById('saisie-vat-rate').value) || 0;
  if (!entered) {
    showToast("Entrez un montant HT/TTC et un taux de TVA d'abord", 'error');
    return;
  }
  const amountType = document.getElementById('saisie-amount-type').value;
  const ht = amountType === 'HT' ? round2(entered) : round2(entered / (1 + rate / 100));
  const ttc = amountType === 'TTC' ? round2(entered) : round2(ht * (1 + rate / 100));
  const tvaAmount = round2(ttc - ht);
  if (journal === 'VENTES') {
    setEntryRow(clientOrChargeRow, {
      account:clientOrChargeRow.querySelector('.account-cell').value,
      auxiliary:clientOrChargeRow.querySelector('.account-cell').dataset.auxiliaryCode || '',
      label:clientOrChargeRow.dataset.lineLabel, side:'D', amount:ttc, fixed:true
    });
    setEntryRow(productOrVatRow, {
      account:productOrVatRow.querySelector('.account-cell').value,
      label:productOrVatRow.dataset.lineLabel, side:'C', amount:ht, rate:String(rate)
    });
    setEntryRow(vatOrSupplierRow, { account:'4455', label:`État TVA facturée ${rate}%`, side:'C', amount:tvaAmount });
  } else {
    setEntryRow(clientOrChargeRow, {
      account:clientOrChargeRow.querySelector('.account-cell').value,
      label:clientOrChargeRow.dataset.lineLabel,
      side:'D', amount:ht, rate:String(rate)
    });
    setEntryRow(productOrVatRow, { account:'34552', label:`État TVA récupérable ${rate}%`, side:'D', amount:tvaAmount });
    setEntryRow(vatOrSupplierRow, {
      account:vatOrSupplierRow.querySelector('.account-cell').value,
      auxiliary:vatOrSupplierRow.querySelector('.account-cell').dataset.auxiliaryCode || '',
      label:vatOrSupplierRow.dataset.lineLabel, side:'C', amount:ttc, fixed:true
    });
  }
  computeTotals();
  showToast('HT + TVA calculés ✓', 'success');
}
let currentDossier = null;
// Couleur d'avatar stable par client (basée sur son id) — palette douce et lisible.
const AVATAR_COLORS = ['#1B4FCC','#059669','#D97706','#7C3AED','#DB2777','#0891B2','#DC2626','#4D7C0F','#9333EA','#0D9488'];
function avatarColor(id) {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name) {
  return name.replace(/^(SARL|SA|STE|Auto-Entrepreneur|Cabinet|Import-Export)\s+/i, '')
    .split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}
function renderDossierScreen() {
  const grid = document.getElementById('dossier-grid');
  const searchEl = document.getElementById('dossier-search');
  const q = (searchEl ? searchEl.value : '').trim().toLowerCase();
  grid.innerHTML = '';
  // Liste complète par défaut, triée par ordre alphabétique — l'accountant peut
  // simplement faire défiler pour trouver un client, ou taper pour filtrer.
  const matches = DATA.dossiers
    .filter(d => !q || d.name.toLowerCase().includes(q) || d.ice.includes(q))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!matches.length) {
    grid.innerHTML = `<div class="ds-empty">Aucun client ou société ne correspond à « ${q} »</div>`;
    return;
  }
  matches.forEach(d => {
    const card = document.createElement('div');
    card.className = 'ds-card';
    card.innerHTML = `<div class="ds-avatar" style="background:${avatarColor(d.id)};">${initials(d.name)}</div>`
      + `<div class="ds-card-body"><div class="ds-name">${d.name}</div><div class="ds-meta">${d.forme} · ICE ${d.ice} · TVA ${d.tva_regime} · ${d.tva_periodicite}</div></div>`
      + `<span class="ds-ex">Exercice ${d.exercice}</span>`;
    // Un clic ouvre d'abord un aperçu (données clés + dernières écritures),
    // jamais directement le dossier complet — Req : ne pas "tout balancer" à l'accountant.
    card.onclick = () => previewClient(d);
    grid.appendChild(card);
  });
}

// ===== Aperçu client (avant ouverture complète du dossier) =====
let pendingPreviewDossier = null;
function computeQuickStatsFor(clientId, year) {
  const client = DATA.clientData[clientId] || { a_nouveaux_by_year: {}, journal_entries: [] };
  const dossier = DATA.dossiers.find(d => d.id === clientId);
  const anv = client.a_nouveaux_by_year[year] || [];
  const entries = (client.journal_entries || []).filter(e => e.year === year);
  let banque = 0, ca = 0, tvaFact = 0, tvaRec = 0;
  anv.forEach(a => { if (String(a.code).charAt(0) === '5') banque += (a.debit || 0) - (a.credit || 0); });
  entries.forEach(e => e.lines.forEach(l => {
    const code = String(l.compte);
    const d = lineDebit(l), c = lineCredit(l);
    if (code.charAt(0) === '5') banque += d - c;
    if (code.charAt(0) === '7') ca += c;
    if (isAccount(code, CGNC.TVA_FACTUREE)) tvaFact += c;
    if (isAccount(code, CGNC.TVA_RECUPERABLE)) tvaRec += d;
  }));
  if (ca === 0) ca = dossier?.demoChiffreAffaires || 0;
  if (tvaFact === 0 && dossier?.demoChiffreAffaires) {
    const rate = dossier.demoTvaRate ?? (dossier.tva_regime === 'Exonéré' ? 0 : 20);
    tvaFact = dossier.demoChiffreAffaires * rate / 100;
  }
  return { banque: round2(banque), ca: round2(ca), tva: tvaPayable(tvaFact, tvaRec), nbEntries: entries.length };
}
function recentEntriesFor(clientId, year, limit) {
  const client = DATA.clientData[clientId] || { journal_entries: [] };
  return (client.journal_entries || []).filter(e => e.year === year).slice(-limit).reverse();
}
function previewClient(d) {
  pendingPreviewDossier = d;
  const stats = computeQuickStatsFor(d.id, d.exercice);
  document.getElementById('cp-avatar').textContent = initials(d.name);
  document.getElementById('cp-avatar').style.background = avatarColor(d.id);
  document.getElementById('cp-name').textContent = d.name;
  document.getElementById('cp-meta').textContent = `${d.forme} · ICE ${d.ice} · TVA ${d.tva_regime} (${d.tva_periodicite}) · Exercice ${d.exercice}`;
  document.getElementById('cp-stats').innerHTML = `
    <div class="cp-stat"><div class="cp-lbl">Solde banque</div><div class="cp-val">${fmtFR(Math.abs(stats.banque))} ${stats.banque >= 0 ? 'D' : 'C'}</div></div>
    <div class="cp-stat"><div class="cp-lbl">Chiffre d'affaires</div><div class="cp-val">${fmtFR(stats.ca)} MAD</div></div>
    <div class="cp-stat"><div class="cp-lbl">TVA à déclarer</div><div class="cp-val">${fmtFR(stats.tva)} MAD</div></div>`;
  const tb = document.getElementById('cp-entries');
  const recent = recentEntriesFor(d.id, d.exercice, 5);
  if (!recent.length) {
    tb.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:14px;">Aucune écriture enregistrée pour cet exercice.</td></tr>`;
  } else {
    const rows = [];
    recent.forEach(e => e.lines.forEach(l => {
      rows.push(`<tr><td>${entryDate(e)}</td><td>${l.compte}</td><td>${l.libelle || ''}</td><td style="text-align:right;">${fmtFR(l.montant || 0)} ${l.dbcr}</td></tr>`);
    }));
    tb.innerHTML = rows.join('');
  }
  openModal('modalClientPreview');
}
function openFullDossierFromPreview() {
  closeModal('modalClientPreview');
  if (pendingPreviewDossier) openDossier(pendingPreviewDossier);
}

// ===== Tous les clients (vue d'ensemble, indépendante d'un dossier précis) =====
function renderAllClientsTable() {
  const q = (document.getElementById('all-clients-search')?.value || '').trim().toLowerCase();
  const list = DATA.dossiers
    .filter(d => !q || d.name.toLowerCase().includes(q) || d.ice.includes(q))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById('ac-count').textContent = `${DATA.dossiers.length} clients au total`;
  const tb = document.getElementById('all-clients-body');
  if (!list.length) {
    tb.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:18px;">Aucun client ne correspond.</td></tr>`;
    return;
  }
  tb.innerHTML = list.map(d => {
    const stats = computeQuickStatsFor(d.id, d.exercice);
    const has = stats.nbEntries > 0;
    const tresorerie = has ? stats.banque : (d.demoTresorerie || 0);
    return `<tr>
      <td><strong>${d.name}</strong><div style="font-size:10px;color:var(--muted);">${d.forme} · ICE ${d.ice}</div></td>
      <td>${d.exercice}</td>
      <td>${d.tva_regime} · ${d.tva_periodicite}</td>
      <td style="text-align:right;">${fmtFR(Math.abs(tresorerie))} MAD ${tresorerie >= 0 ? 'D' : 'C'}</td>
      <td style="text-align:right;">${fmtFR(stats.tva)} MAD</td>
      <td><button class="btn btn-s btn-xs" data-action="previewClientById('${d.id}')">Aperçu</button></td>
    </tr>`;
  }).join('');
}
function previewClientById(id) {
  const d = DATA.dossiers.find(x => x.id === id);
  if (!d) return;
  closeModal('modalAllClients');
  previewClient(d);
}
function openAllClients() {
  renderAllClientsTable();
  openModal('modalAllClients');
}

function openDossier(d) {
  // Accept either a full dossier object or a minimal {name, exercice/year}
  // Resolve the canonical dossier (with id) from DATA by id or name.
  const full = DATA.dossiers.find(x => x.id === d.id || x.name === d.name) || d;
  currentDossier = full;
  currentClientId = full.id || 'C001';
  currentYear = full.exercice || d.exercice || d.year || currentYear;
  syncState();
  loadPersistedJournalEntries(currentClientId, currentYear);
  document.getElementById('dossier-screen').classList.add('hidden');
  document.getElementById('client-badge').textContent = full.name + ' — ' + currentYear;
  // Reset the active-exercise highlight in the sidebar to the dossier's year.
  document.querySelectorAll('.ex-item').forEach(e => e.classList.remove('active'));
  document.getElementById('ex-' + currentYear)?.classList.add('active');
  document.getElementById('readonly-banner').style.display = 'none';
  suggestPiece();
  renderAll();
  showPanel('home');
  showToast('Dossier ouvert : ' + full.name, 'info');
}
function showDossierScreen() {
  document.getElementById('dossier-screen').classList.remove('hidden');
  const searchEl = document.getElementById('dossier-search');
  if (searchEl) { searchEl.value = ''; }
  renderDossierScreen();
}

// ===== CONSULTATION: Grand Livre + Balance (Req 6,7,8) =====
// True when the year has no à-nouveaux and no entries (fully closed archive).
function yearHasData(year) {
  return (aNouveauxFor(year).length > 0) ||
         clientEntries().some(e => e.year === year);
}

function renderConsultation() {
  const view = document.getElementById('consult-view');
  if (!view) return;
  const glWrap = document.getElementById('consult-gl');
  const balWrap = document.getElementById('consult-balance');
  // Fully-closed exercice with no data → show closure notice only
  if (!yearHasData(currentYear)) {
    glWrap.style.display = 'block';
    balWrap.style.display = 'none';
    document.getElementById('gl-title').textContent = 'Exercice ' + currentYear;
    document.getElementById('gl-tag').textContent = '🔒 Clôturé';
    const tb = document.getElementById('gl-body');
    const closed = CLOSED_DATES[currentYear];
    tb.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:28px;">🔒 Exercice clôturé${closed ? ' le ' + closed : ''} — aucune donnée à afficher.</td></tr>`;
    return;
  }
  if (view.value === 'balance') {
    glWrap.style.display = 'none';
    balWrap.style.display = 'block';
    renderBalance();
  } else {
    glWrap.style.display = 'block';
    balWrap.style.display = 'none';
    renderGrandLivre();
  }
}

function anOpening(account) {
  const an = aNouveauxFor(currentYear).find(a => a.code === account);
  return an ? { debit:an.debit, credit:an.credit } : { debit:0, credit:0 };
}

function renderGrandLivre() {
  const filter = (AppState.grandLivreFilter || document.getElementById('consult-account').value || '').trim();
  const tb = document.getElementById('gl-body');
  tb.innerHTML = '';
  // Determine the accounts touched this year (à-nouveaux + mouvements).
  const touched = new Set();
  aNouveauxFor(currentYear).forEach(a => touched.add(a.code));
  clientEntries().filter(e => e.year === currentYear).forEach(e => e.lines.forEach(l => touched.add(l.compte)));
  let accounts;
  if (filter) {
    document.getElementById('gl-title').textContent = 'Grand Livre — ' + filter + (ACCOUNTS[filter] ? ' · ' + ACCOUNTS[filter] : '');
    document.getElementById('gl-tag').textContent = filter + (ACCOUNTS[filter] ? ' · ' + ACCOUNTS[filter] : '');
    accounts = [filter];
  } else {
    document.getElementById('gl-title').textContent = 'Grand Livre — Tous les comptes';
    document.getElementById('gl-tag').textContent = 'Exercice ' + currentYear;
    accounts = Array.from(touched).sort();
  }
  if (!accounts.length) {
    tb.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:20px;">Aucun mouvement pour l'exercice ${currentYear}</td></tr>`;
    return;
  }
  accounts.forEach((acct, idx) => {
    // Separator header per account in all-accounts mode
    if (!filter) {
      const sep = document.createElement('tr');
      sep.style.background = '#EEF2FF';
      sep.innerHTML = `<td colspan="9" style="font-weight:700;color:#3730A3;">${acct} · ${ACCOUNTS[acct] || ''}</td>`;
      tb.appendChild(sep);
    }
    const opening = anOpening(acct);
    let solde = round2(opening.debit - opening.credit);
    let totD = 0, totC = 0;
    const anTr = document.createElement('tr');
    anTr.style.background = '#F9FAFB';
    anTr.innerHTML = `<td colspan="5"><strong>À nouveau (01/01/${currentYear})</strong></td><td style="text-align:right;"><strong>${opening.debit ? fmtFR(opening.debit) : '—'}</strong></td><td style="text-align:right;"><strong>${opening.credit ? fmtFR(opening.credit) : '—'}</strong></td><td style="text-align:right;"><strong>${soldeLabel(solde)}</strong></td><td></td>`;
    tb.appendChild(anTr);
    // Journal lines for this account (chronological: mois then jour)
    const rows = [];
    clientEntries().filter(e => e.year === currentYear).forEach(e => {
      e.lines.forEach(l => { if (l.compte === acct) rows.push({ e, l }); });
    });
    rows.sort((a, b) => (Number(a.e.mois) - Number(b.e.mois)) || (Number(a.e.jour) - Number(b.e.jour)));
    rows.forEach(({ e, l }) => {
      const d = lineDebit(l), c = lineCredit(l);
      solde = round2(solde + d - c);
      totD += d; totC += c;
      const fact = l.facture || e.n_facture || '—';
      const lettr = l.lettre ? `<span class="status s-green">${l.lettre}</span>` : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${entryDate(e)}</td><td>${e.journal}</td><td>${e.piece}</td><td>${factBadge(fact)}</td><td>${l.libelle||''}</td><td style="text-align:right;">${d ? fmtFR(d) : '—'}</td><td style="text-align:right;">${c ? fmtFR(c) : '—'}</td><td style="text-align:right;">${soldeLabel(solde)}</td><td style="text-align:center;">${lettr}</td>`;
      tb.appendChild(tr);
    });
    const cumulD = round2(opening.debit + totD), cumulC = round2(opening.credit + totC);
    addSummaryRow(tb, 'Total Mouvements', round2(totD), round2(totC));
    addSummaryRow(tb, 'Opérations Cumulées', cumulD, cumulC);
    const fin = document.createElement('tr');
    fin.className = 'total-row';
    fin.innerHTML = `<td colspan="7"><strong>Solde final</strong></td><td style="text-align:right;"><strong>${soldeLabel(round2(cumulD - cumulC))}</strong></td><td></td>`;
    tb.appendChild(fin);
  });
}
function soldeLabel(s) {
  if (Math.abs(s) < 0.005) return '0,00';
  return fmtFR(Math.abs(s)) + (s > 0 ? ' D' : ' C');
}
function addSummaryRow(tb, label, d, c) {
  const tr = document.createElement('tr');
  tr.style.background = 'var(--bg)';
  tr.innerHTML = `<td colspan="5" style="font-weight:600;">${label}</td><td style="text-align:right;font-weight:600;">${d ? fmtFR(d) : '—'}</td><td style="text-align:right;font-weight:600;">${c ? fmtFR(c) : '—'}</td><td></td><td></td>`;
  tb.appendChild(tr);
}

// Principe AN/NON (Req 1.2) : classes 1 à 5 = BILAN → AN (reporté en à-nouveaux),
// classes 6 et 7 = CPC → NON (soldé chaque exercice, non reporté).
function anNonInfo(code) {
  const cl = String(code).charAt(0);
  return ['1', '2', '3', '4', '5'].includes(cl)
    ? { tag: 'AN', section: 'BILAN', label: 'BILAN — comptes "AN" (À-Nouveaux, classes 1 à 5)' }
    : { tag: 'NON', section: 'CPC', label: 'CPC — comptes "NON" (non reportés, classes 6 et 7)' };
}
function anNonBadge(code) {
  const info = anNonInfo(code);
  return info.tag === 'AN'
    ? `<span class="status s-blue">AN</span>`
    : `<span class="status s-gray">NON</span>`;
}
// Mode de balance choisi par l'accountant (Req 1.4) : generale / clients / fournisseurs.
let balanceMode = 'generale';
function openBalance(mode) {
  balanceMode = mode;
  closeModal('modalBalanceChoice');
  showPanel('consultation');
  const view = document.getElementById('consult-view');
  if (view) view.value = 'balance';
  renderConsultation();
}
function renderBalance() {
  document.getElementById('balance-year').textContent = 'Exercice ' + currentYear;
  const modeLabels = { generale: 'Générale', clients: 'Aux Clients', fournisseurs: 'Aux Fournisseurs' };
  const modeLbl = document.getElementById('balance-mode-label');
  if (modeLbl) modeLbl.textContent = modeLabels[balanceMode] || 'Générale';
  const tb = document.getElementById('balance-body');
  tb.innerHTML = '';
  // Aggregate à-nouveaux and mouvements separately per account.
  const totals = {};
  const touch = a => { if (!totals[a]) totals[a] = { anD:0, anC:0, mvD:0, mvC:0 }; return totals[a]; };
  aNouveauxFor(currentYear).forEach(a => { const t = touch(a.code); t.anD += a.debit || 0; t.anC += a.credit || 0; });
  clientEntries().filter(e => e.year === currentYear).forEach(e => {
    e.lines.forEach(l => { const t = touch(l.compte); t.mvD += lineDebit(l); t.mvC += lineCredit(l); });
  });
  let accounts = Object.keys(totals).sort();
  if (balanceMode === 'clients') accounts = accounts.filter(a => isAccount(a, CGNC.CLIENTS));
  else if (balanceMode === 'fournisseurs') accounts = accounts.filter(a => isAccount(a, CGNC.FOURNISSEURS));
  if (!accounts.length) {
    const msg = balanceMode === 'clients' ? 'Aucun compte client (3421...) pour l\'exercice ' + currentYear
      : balanceMode === 'fournisseurs' ? 'Aucun compte fournisseur (4411...) pour l\'exercice ' + currentYear
      : 'Aucune donnée pour l\'exercice ' + currentYear;
    tb.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:20px;">${msg}</td></tr>`;
    return;
  }
  const classes = {};
  accounts.forEach(a => { const cl = a.charAt(0); (classes[cl] = classes[cl] || []).push(a); });
  // Regroupement BILAN (AN, classes 1-5) puis CPC (NON, classes 6-7).
  const groups = [
    { key: 'AN', title: '📘 BILAN — Comptes "AN" (reportés en À-Nouveaux)', classes: ['1','2','3','4','5'] },
    { key: 'NON', title: '📙 CPC — Comptes "NON" (soldés en fin d\'exercice)', classes: ['6','7'] }
  ];
  let gAnD = 0, gAnC = 0, gMvD = 0, gMvC = 0, gSD = 0, gSC = 0;
  groups.forEach(group => {
    const groupClasses = group.classes.filter(cl => classes[cl]);
    if (!groupClasses.length) return;
    const sepTr = document.createElement('tr');
    sepTr.style.background = '#EEF2FF';
    sepTr.innerHTML = `<td colspan="9" style="font-weight:700;color:#3730A3;">${group.title}</td>`;
    tb.appendChild(sepTr);
    groupClasses.sort().forEach(cl => {
      let cAnD = 0, cAnC = 0, cMvD = 0, cMvC = 0, cSD = 0, cSC = 0;
      classes[cl].forEach(a => {
        const t = totals[a];
        const anD = round2(t.anD), anC = round2(t.anC), mvD = round2(t.mvD), mvC = round2(t.mvC);
        const solde = round2((anD + mvD) - (anC + mvC));
        const sd = solde > 0 ? solde : 0;
        const sc = solde < 0 ? -solde : 0;
        cAnD += anD; cAnC += anC; cMvD += mvD; cMvC += mvC; cSD += sd; cSC += sc;
        const isDiv = a.length > 4;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td style="${isDiv?'padding-left:26px;color:var(--muted);':'font-weight:600;'}">${a}</td><td style="${isDiv?'color:var(--muted);':''}">${ACCOUNTS[a]||''}</td>`
          + `<td style="text-align:center;">${anNonBadge(a)}</td>`
          + `<td style="text-align:right;">${anD ? fmtFR(anD) : '—'}</td><td style="text-align:right;">${anC ? fmtFR(anC) : '—'}</td>`
          + `<td style="text-align:right;">${mvD ? fmtFR(mvD) : '—'}</td><td style="text-align:right;">${mvC ? fmtFR(mvC) : '—'}</td>`
          + `<td class="debit-c" style="text-align:right;">${sd ? fmtFR(sd) : '—'}</td><td class="credit-c" style="text-align:right;">${sc ? fmtFR(sc) : '—'}</td>`;
        tb.appendChild(tr);
      });
      gAnD += cAnD; gAnC += cAnC; gMvD += cMvD; gMvC += cMvC; gSD += cSD; gSC += cSC;
      const clTr = document.createElement('tr');
      clTr.style.background = 'var(--bg)';
      clTr.innerHTML = `<td colspan="3" style="font-weight:700;">Total classe ${cl}</td>`
        + `<td style="text-align:right;font-weight:700;">${cAnD ? fmtFR(cAnD) : '—'}</td><td style="text-align:right;font-weight:700;">${cAnC ? fmtFR(cAnC) : '—'}</td>`
        + `<td style="text-align:right;font-weight:700;">${cMvD ? fmtFR(cMvD) : '—'}</td><td style="text-align:right;font-weight:700;">${cMvC ? fmtFR(cMvC) : '—'}</td>`
        + `<td style="text-align:right;font-weight:700;">${cSD ? fmtFR(cSD) : '—'}</td><td style="text-align:right;font-weight:700;">${cSC ? fmtFR(cSC) : '—'}</td>`;
      tb.appendChild(clTr);
    });
  });
  const tot = document.createElement('tr');
  tot.className = 'total-row';
  tot.innerHTML = `<td colspan="3"><strong>TOTAUX</strong></td>`
    + `<td style="text-align:right;"><strong>${fmtFR(round2(gAnD))}</strong></td><td style="text-align:right;"><strong>${fmtFR(round2(gAnC))}</strong></td>`
    + `<td style="text-align:right;"><strong>${fmtFR(round2(gMvD))}</strong></td><td style="text-align:right;"><strong>${fmtFR(round2(gMvC))}</strong></td>`
    + `<td class="debit-c" style="text-align:right;"><strong>${fmtFR(round2(gSD))}</strong></td><td class="credit-c" style="text-align:right;"><strong>${fmtFR(round2(gSC))}</strong></td>`;
  tb.appendChild(tot);
}

// ===== PLAN COMPTABLE MAROCAIN — édition (Req 1.6) =====
function renderPlanComptable() {
  const tb = document.getElementById('pcm-body');
  if (!tb) return;
  const searchEl = document.getElementById('pcm-search');
  const q = (searchEl ? searchEl.value : '').trim().toLowerCase();
  const classFilter = document.getElementById('pcm-class-filter')?.value || 'all';
  const source = PCM_HIERARCHY.length ? PCM_HIERARCHY : pcmBaseAccounts().map(a => ({
    code:a.code, label:a.label, class:a.classe, level:a.level || 'account', parent:a.parent, type:a.type
  }));
  const matchingClasses = source.filter(a => a.level === 'class'
    && (classFilter === 'all' || a.code === classFilter)
    && (!q || a.code.toLowerCase().includes(q) || (a.label || '').toLowerCase().includes(q)));
  const accountNodes = source.filter(a => a.level !== 'class');
  const matchingNodes = accountNodes.filter(a =>
    (classFilter === 'all' || String(a.class) === classFilter)
    && (!q || a.code.toLowerCase().includes(q) || (a.label || '').toLowerCase().includes(q))
  );
  const visibleCodes = new Set(matchingNodes.map(a => a.code));
  const byCode = new Map(source.map(a => [a.code, a]));
  matchingNodes.forEach(node => {
    let parent = node.parent;
    while (parent) {
      visibleCodes.add(parent);
      parent = byCode.get(parent)?.parent;
    }
  });
  matchingClasses.forEach(node => visibleCodes.add(node.code));
  const list = source.filter(a => visibleCodes.has(a.code)
    && (a.level !== 'class' || classFilter === 'all' || a.code === classFilter));
  const levelLabels = {
    class:'Classe',
    rubrique:'Rubrique',
    poste:'Poste',
    principal:'Compte principal',
    divisionnaire:'Compte divisionnaire'
  };
  tb.innerHTML = '';
  if (!list.length) {
    tb.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:18px;">Aucun compte ne correspond à la recherche.</td></tr>`;
    return;
  }
  list.forEach(a => {
    const cl = a.class || a.classe || Number(String(a.code).charAt(0));
    const isClass = a.level === 'class';
    const level = levelLabels[a.level] || 'Compte';
    const indent = isClass ? 0 : Math.max(1, String(a.code).length) * 8;
    const bold = isClass || a.level === 'rubrique' || a.level === 'poste';
    const tr = document.createElement('tr');
    if (isClass) tr.style.background = 'var(--bg)';
    tr.innerHTML = `
      <td><input type="text" value="${escapeAux(a.code)}" style="font-weight:${bold ? '700' : '400'};" onchange="editPcmCode('${escapeAux(a.code)}', this.value, this)"></td>
      <td><input type="text" value="${escapeAux(a.label || '')}" style="padding-left:${indent}px;font-weight:${bold ? '700' : '400'};" onchange="editPcmLabel('${escapeAux(a.code)}', this.value)"></td>
      <td style="text-align:center;color:var(--muted);">${cl}</td>
      <td style="text-align:center;"><span class="status ${isClass ? 's-gray' : 's-blue'}">${level}</span></td>
      <td style="text-align:center;">${anNonBadge(a.code)}</td>
      <td style="text-align:center;"><button class="btn btn-d btn-xs" data-action="deletePcmAccount('${escapeAux(a.code)}')" title="Supprimer">✕</button></td>`;
    tb.appendChild(tr);
  });
  const auxBody = document.getElementById('aux-body');
  const auxRows = activeAuxiliaryAccounts().filter(a => !q || Object.values(a).some(v => String(v || '').toLowerCase().includes(q)));
  const auxCount = document.getElementById('aux-count');
  if (auxCount) auxCount.textContent = `${auxRows.length} compte(s) pour le dossier actif`;
  if (auxBody) auxBody.innerHTML = auxRows.length ? auxRows.map(a => `<tr><td>${escapeAux(a.compte_auxiliaire)}</td><td>${escapeAux(a.libelle)}</td><td>${escapeAux(a.compte_racine)}</td><td>${escapeAux(a.ice)}</td><td>${escapeAux(a.identifiant_fiscal)}</td><td>${escapeAux(a.type_tiers)}</td></tr>`).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:14px;">Aucun compte complémentaire importé pour ce dossier.</td></tr>';
}
function escapeAux(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function previewPcgeGeneral() {
  try {
    const response = await apiFetch(`${KOMPTA_API_BASE}/api/accounts/pcge-general/preview`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({accountCatalog: DATA.accounts.filter(account => account.standard)}) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail?.message || 'Source PCGE indisponible.');
    const rows = body.added || [];
    document.getElementById('pcge-preview-summary').textContent = `${rows.length} à ajouter · ${(body.alreadyPresent || []).length} déjà présents · ${(body.needsReview || []).length} à vérifier · classes 0 et 9 séparées`;
    document.getElementById('pcge-preview-body').innerHTML = rows.slice(0, 150).map(a => `<tr><td>${escapeAux(a.code)}</td><td>${escapeAux(a.label)}</td><td>${escapeAux(a.parent || '—')}</td></tr>`).join('') || '<tr><td colspan="3">Aucun compte nouveau.</td></tr>';
    document.getElementById('pcge-preview-more').textContent = rows.length > 150 ? `... ${rows.length - 150} ligne(s) supplémentaire(s)` : '';
    document.getElementById('pcge-import-confirm').disabled = !rows.length;
    openModal('modalPcgeImport');
  } catch (error) { showToast(error.message, 'error'); }
}
async function importPcgeGeneral() {
  const button = document.getElementById('pcge-import-confirm'); button.disabled = true;
  try {
    const response = await apiFetch(`${KOMPTA_API_BASE}/api/accounts/pcge-general/import`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({accountCatalog: DATA.accounts.filter(account => account.standard)}) });
    const report = await response.json();
    if (!response.ok) throw new Error(report.detail?.message || 'Import PCGE impossible.');
    (report.imported || []).forEach(account => {
      if (DATA.accounts.some(existing => existing.code === account.code)) return;
      const item = {code: account.code, label: account.label, type: 'parent', parent: account.parent || undefined, classe: account.class, standard: true};
      DATA.accounts.push(item); ACCOUNTS[item.code] = item.label; window.PCM_MAROC.push({code: item.code, libelle: item.label, classe: item.classe});
    });
    persistCustomizationState(); renderPlanComptable(); closeModal('modalPcgeImport');
    showToast(`${report.importedCount || 0} compte(s) PCGE ajouté(s); ${(report.alreadyPresent || []).length} déjà présents; ${(report.needsReview || []).length} à vérifier.`, 'success');
  } catch (error) { button.disabled = false; showToast(error.message, 'error'); }
}
function openAuxImport() {
  pendingAuxImport = [];
  document.getElementById('aux-import-dossier').textContent = DATA.dossiers.find(d => d.id === currentClientId)?.name || currentClientId;
  document.getElementById('aux-file-name').textContent = 'Aucun fichier sélectionné';
  document.getElementById('aux-import-summary').style.display = 'none';
  document.getElementById('aux-import-preview').style.display = 'none';
  document.getElementById('aux-import-confirm').disabled = true;
  openModal('modalAuxImport');
}
function handleAuxDrop(event) { event.preventDefault(); document.getElementById('aux-drop').classList.remove('dragover'); handleAuxFile(event.dataTransfer.files[0]); }
function handleAuxFile(file) {
  if (!file) return;
  const name = file.name.toLowerCase();
  if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) { showToast('Format accepté : CSV ou XLSX', 'error'); return; }
  document.getElementById('aux-file-name').textContent = file.name;
  const reader = new FileReader();
  reader.onload = event => {
    try {
      const rows = name.endsWith('.xlsx') ? XLSX.utils.sheet_to_json(XLSX.read(event.target.result, { type:'array' }).Sheets[XLSX.read(event.target.result, { type:'array' }).SheetNames[0]], { defval:'', raw:false }) : parseAuxCsv(new TextDecoder('utf-8').decode(event.target.result));
      showAuxPreview(rows);
    } catch (error) { showToast('Impossible de lire le fichier : ' + error.message, 'error'); }
  };
  reader.readAsArrayBuffer(file);
}
function parseAuxCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) { const c = text[i], next = text[i + 1]; if (c === '"' && quoted && next === '"') { cell += '"'; i++; } else if (c === '"') quoted = !quoted; else if (c === ',' && !quoted) { row.push(cell); cell = ''; } else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && next === '\n') i++; row.push(cell); if (row.some(v => v.trim())) rows.push(row); row = []; cell = ''; } else cell += c; }
  if (cell || row.length) { row.push(cell); if (row.some(v => v.trim())) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map(h => h.trim().replace(/^\uFEFF/, ''));
  return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, String(values[i] ?? '').trim()])));
}
function validateAuxRows(rows) {
  const roots = new Set(pcmBaseAccounts().map(a => String(a.code)));
  const existing = activeAuxiliaryAccounts();
  const codes = new Set(existing.map(a => a.compte_auxiliaire));
  const legalIds = new Set(existing.filter(a => a.ice || a.identifiant_fiscal).map(a => `${a.ice}|${a.identifiant_fiscal}`));
  const fileCodes = new Set(), fileIds = new Set();
  return rows.map((raw, index) => {
    const data = Object.fromEntries(AUX_FIELDS.map(field => [field, String(raw[field] ?? '').trim()]));
    const errors = [];
    if (!AUX_FIELDS.every(field => Object.prototype.hasOwnProperty.call(raw, field))) errors.push('En-têtes requis manquants');
    if (!/^\d{5,}$/.test(data.compte_auxiliaire)) errors.push('Compte auxiliaire : au moins 5 chiffres requis');
    if (!roots.has(data.compte_racine)) errors.push(`Compte racine ${data.compte_racine || 'vide'} inexistant dans le PCM`);
    if (!data.libelle) errors.push('Libellé obligatoire');
    if (data.ice && !/^\d{15}$/.test(data.ice)) errors.push('ICE invalide : 15 chiffres exactement');
    if (!AUX_TYPES.includes(data.type_tiers)) errors.push('Type tiers invalide');
    const pair = `${data.ice}|${data.identifiant_fiscal}`;
    if (codes.has(data.compte_auxiliaire) || fileCodes.has(data.compte_auxiliaire)) errors.push('Compte auxiliaire déjà existant ou dupliqué');
    if ((data.ice || data.identifiant_fiscal) && (legalIds.has(pair) || fileIds.has(pair))) errors.push('Duo ICE + IF déjà existant ou dupliqué');
    fileCodes.add(data.compte_auxiliaire); if (data.ice || data.identifiant_fiscal) fileIds.add(pair);
    return { data, errors, row: index + 2 };
  });
}
function showAuxPreview(rows) {
  const results = validateAuxRows(rows); pendingAuxImport = results;
  const valid = results.filter(r => !r.errors.length).length;
  const summary = document.getElementById('aux-import-summary'); summary.style.display = 'flex'; summary.innerHTML = `<span>Total : ${results.length}</span><span class="valid">Valides : ${valid}</span><span class="invalid">Invalides : ${results.length - valid}</span>`;
  const preview = document.getElementById('aux-import-preview'); preview.style.display = 'block';
  preview.innerHTML = `<table><thead><tr><th>Ligne</th>${AUX_FIELDS.map(f => `<th>${f}</th>`).join('')}<th>Résultat</th></tr></thead><tbody>${results.map(r => `<tr class="${r.errors.length ? 'row-error' : ''}"><td>${r.row}</td>${AUX_FIELDS.map(f => `<td>${escapeAux(r.data[f])}</td>`).join('')}<td title="${escapeAux(r.errors.join(' | '))}">${r.errors.length ? escapeAux(r.errors.join(' ; ')) : 'Valide'}</td></tr>`).join('')}</tbody></table>`;
  const confirm = document.getElementById('aux-import-confirm'); confirm.disabled = valid === 0; confirm.textContent = `Importer ${valid} ligne(s) valide(s)`;
}
function importValidAuxAccounts() {
  const valid = pendingAuxImport.filter(r => !r.errors.length).map(r => r.data); if (!valid.length) return;
  const target = activeAuxiliaryAccounts(); valid.forEach(data => target.push(data));
  persistCustomizationState(); renderPlanComptable(); closeModal('modalAuxImport'); showToast(`${valid.length} compte(s) complémentaire(s) importé(s) ✓`, 'success');
}
function downloadAuxTemplate() { exportAuxRows([{ compte_auxiliaire:'44110004', libelle:'Nouveau fournisseur SARL', compte_racine:'4411', ice:'001234567890004', identifiant_fiscal:'40123456', type_tiers:'Fournisseur' }, { compte_auxiliaire:'34210003', libelle:'Nouveau client', compte_racine:'3421', ice:'001234567890005', identifiant_fiscal:'40123457', type_tiers:'Client' }], 'modele_plan_complementaire.xlsx'); }
function exportAuxAccounts(format) { exportAuxRows(activeAuxiliaryAccounts(), dossierFileName(`plan_complementaire.${format}`)); }
function exportAuxRows(rows, filename) {
  const values = [AUX_FIELDS, ...rows.map(row => AUX_FIELDS.map(field => row[field] || ''))];
  if (filename.endsWith('.xlsx') && window.XLSX) { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(values), 'Tiers'); XLSX.writeFile(book, filename); return; }
  const csv = values.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([ '\uFEFF' + csv ], { type:'text/csv;charset=utf-8' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename.replace(/\.xlsx$/, '.csv'); link.click(); URL.revokeObjectURL(link.href);
}

const CUSTOMIZATION_KEY = 'kompta_customization_v1';
function persistCustomizationState() {
  try {
    localStorage.setItem(CUSTOMIZATION_KEY, JSON.stringify({ auxiliary: AUXILIARY_ACCOUNTS }));
    return true;
  } catch (error) {
    showToast('Enregistrement navigateur impossible. Les changements restent en mémoire pour cette session.', 'error');
    return false;
  }
}
function loadCustomizationState() {
  try {
    const saved = JSON.parse(localStorage.getItem(CUSTOMIZATION_KEY) || 'null');
    if (!saved) {
      seedDemoAuxiliaryAccounts();
      return;
    }
    if (saved.auxiliary && typeof saved.auxiliary === 'object') {
      Object.entries(saved.auxiliary).forEach(([clientId, rows]) => {
        if (!Array.isArray(rows)) return;
        AUXILIARY_ACCOUNTS[clientId] = rows;
      });
    }
    seedDemoAuxiliaryAccounts();
  } catch (error) {
    console.warn('Etat de personnalisation ignoré:', error);
    showToast('Personnalisation locale illisible; les paramètres par défaut sont utilisés.', 'error');
  }
}

const ENTRY_NAV_FIELDS = ['.account-cell', '.debit-input', '.credit-input'];
function moveEntryFocus(current, backwards = false) {
  const row = current.closest('tr');
  if (!backwards && current.matches('.debit-input') && row?.classList.contains('entry-debit-row') && parseAmount(current.value) > 0) {
    let nextRow = row.nextElementSibling;
    if (!nextRow) { addLine(); nextRow = row.nextElementSibling; }
    nextRow?.querySelector('.credit-input')?.focus();
    return;
  }
  const fields = [...document.querySelectorAll('#lines-body input, #lines-body select')]
    .filter(field => ENTRY_NAV_FIELDS.some(selector => field.matches(selector)));
  const index = fields.indexOf(current);
  const nextIndex = index + (backwards ? -1 : 1);
  if (nextIndex >= 0 && nextIndex < fields.length) { fields[nextIndex].focus(); fields[nextIndex].select?.(); return; }
  if (!backwards) { addLine(); document.querySelector('#lines-body tr:last-child .account-cell')?.focus(); }
}
function handleEntryGridKeydown(event) {
  if (event.altKey && event.key.toLowerCase() === 'n') { event.preventDefault(); addLine(); return; }
  if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); validerEcriture(); return; }
  if (!event.target.closest('#lines-body')) return;
  if (event.key === 'Tab' || event.key === 'Enter') { event.preventDefault(); moveEntryFocus(event.target, event.shiftKey); }
}
document.addEventListener('keydown', handleEntryGridKeydown);
let menuReportRows = [];
let menuReportHeaders = [];
let menuReportDisplayRows = [];
let menuReportFilter = { query:'', journal:'all' };
function menuEscape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function reportIsMoney(header) { return /débit|crédit|solde|montant|taxe|base taxable|produits|charges|résultat|is estimé/i.test(header); }
function reportCell(value, header) { return typeof value === 'number' ? `${fmtFR(value)}${reportIsMoney(header) ? ' MAD' : ''}` : menuEscape(value); }
function openMenuWorkflow(title, body, actionLabel, action) {
  document.getElementById('menu-modal-title').textContent = title;
  document.getElementById('menu-modal-year').textContent = currentYear;
  document.getElementById('menu-modal-body').innerHTML = body;
  const primary = document.getElementById('menu-modal-primary');
  primary.textContent = actionLabel || 'Fermer';
  primary.onclick = action || (() => closeModal('modalMenuWorkflow'));
  openModal('modalMenuWorkflow');
}
function menuRows() { return clientEntries().filter(e => e.year === currentYear).slice().sort((a, b) => (Number(a.mois) - Number(b.mois)) || (Number(a.jour) - Number(b.jour))); }
function reportRowsFromEntries() { return menuRows().map(e => ({ date:entryDate(e), journal:e.journal, piece:e.piece, libelle:e.libelle || '', debit:round2(e.lines.reduce((s, l) => s + lineDebit(l), 0)), credit:round2(e.lines.reduce((s, l) => s + lineCredit(l), 0)) })); }
function renderMenuReport(title, rows) {
  renderStructuredReport(title, ['Date','Journal','Pièce','Libellé','Débit','Crédit'], rows.map(r => [r.date, r.journal, r.piece, r.libelle, r.debit, r.credit]), rows);
}
function renderStructuredReport(title, headers, rows, exportRows) {
  menuReportRows = exportRows || rows;
  menuReportHeaders = headers;
  menuReportDisplayRows = rows;
  menuReportFilter = { query:'', journal:'all' };
  const journalIndex = headers.findIndex(h => /journal/i.test(h));
  const journals = journalIndex >= 0 ? [...new Set(rows.map(row => row[journalIndex]).filter(Boolean))].sort() : [];
  const filterBar = `<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:12px;"><div class="fg" style="flex:1;min-width:190px;"><label>Recherche</label><input id="menu-report-query" type="search" placeholder="Filtrer le rapport..." oninput="menuReportFilter.query=this.value;renderMenuReportBody()"></div>${journals.length ? `<div class="fg"><label>Journal</label><select id="menu-report-journal" onchange="menuReportFilter.journal=this.value;renderMenuReportBody()"><option value="all">Tous les journaux</option>${journals.map(j => `<option value="${menuEscape(j)}">${menuEscape(j)}</option>`).join('')}</select></div>` : ''}<span class="badge" id="menu-report-count">${rows.length} ligne(s)</span></div><div id="menu-report-table"></div>`;
  openMenuWorkflow(title + ' — Exercice ' + currentYear, filterBar, 'Exporter Excel', exportMenuReport);
  renderMenuReportBody();
}
function renderMenuReportBody() {
  const table = document.getElementById('menu-report-table'); if (!table) return;
  const query = menuReportFilter.query.toLowerCase().trim();
  const journalIndex = menuReportHeaders.findIndex(h => /journal/i.test(h));
  const rows = menuReportDisplayRows.filter(row => (!query || row.some(cell => String(cell).toLowerCase().includes(query))) && (menuReportFilter.journal === 'all' || journalIndex < 0 || String(row[journalIndex]) === menuReportFilter.journal));
  table.innerHTML = rows.length ? `<div style="overflow:auto;max-height:390px;"><table><thead><tr>${menuReportHeaders.map(h => `<th>${menuEscape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, i) => `<td style="${i > 0 && typeof cell === 'number' ? 'text-align:right;' : ''}">${reportCell(cell, menuReportHeaders[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div style="padding:22px;text-align:center;color:var(--muted);">Aucun résultat pour ces filtres.</div>';
  const count = document.getElementById('menu-report-count'); if (count) count.textContent = rows.length + ' ligne(s)';
}
function reportEntryLines() { return menuRows().flatMap(e => e.lines.map(l => ({e, l, debit:lineDebit(l), credit:lineCredit(l)}))); }
function showAgedBalanceReport() {
  const groups = {};
  reportEntryLines().filter(x => isAccount(x.l.compte, CGNC.CLIENTS, CGNC.FOURNISSEURS)).forEach(x => { const code = x.l.compte; const g = groups[code] || (groups[code] = {code, label:ACCOUNTS[code] || x.l.libelle || '', amount:0}); g.amount += x.debit - x.credit; });
  const rows = Object.values(groups).map(g => { const age = Math.max(0, Math.floor((Date.now() - new Date(currentYear, Number(menuRows()[0]?.mois || 1) - 1, Number(menuRows()[0]?.jour || 1))) / 86400000)); const bucket = age > 90 ? '+90 jours' : age > 60 ? '61–90 jours' : age > 30 ? '31–60 jours' : '0–30 jours'; return [g.code, g.label, bucket, round2(Math.abs(g.amount))]; });
  renderStructuredReport('LA BALANCE ÂGÉE', ['Compte','Tiers','Ancienneté','Solde'], rows);
}
function showCentralJournalReport() {
  const groups = {};
  reportRowsFromEntries().forEach(r => { const g = groups[r.journal] || (groups[r.journal] = {journal:r.journal, count:0, debit:0, credit:0}); g.count++; g.debit += r.debit; g.credit += r.credit; });
  renderStructuredReport('Journal Centralisateur', ['Journal','Écritures','Total Débit','Total Crédit'], Object.values(groups).map(g => [g.journal, g.count, round2(g.debit), round2(g.credit)]));
}
function showClientInvoicesReport() {
  const groups = {};
  reportEntryLines().filter(x => isAccount(x.l.compte, CGNC.CLIENTS) || x.e.n_facture).forEach(x => { const ref = x.l.facture || x.e.n_facture || 'Sans référence'; const g = groups[ref] || (groups[ref] = {ref, date:entryDate(x.e), client:ACCOUNTS[x.l.compte] || x.l.libelle || 'Client', amount:0}); g.amount += x.credit || x.debit; });
  renderStructuredReport('Factures Clients', ['Facture','Date','Client','Montant','Statut'], Object.values(groups).map(g => [g.ref, g.date, g.client, round2(g.amount), 'À suivre']));
}
function showBalanceSheetReport() {
  const groups = {};
  reportEntryLines().filter(x => /^[1-5]/.test(String(x.l.compte))).forEach(x => { const cl = String(x.l.compte).charAt(0); const g = groups[cl] || (groups[cl] = {cl, debit:0, credit:0}); g.debit += x.debit; g.credit += x.credit; });
  const rows = Object.values(groups).map(g => [g.cl <= 3 ? 'Actif / capitaux' : 'Dettes et tiers', 'Classe ' + g.cl, round2(g.debit), round2(g.credit), round2(Math.abs(g.debit - g.credit))]);
  renderStructuredReport('Bilan Actif / Passif', ['Rubrique','Classe','Débit','Crédit','Solde'], rows);
}
function showTaxReport() {
  const charges = reportEntryLines().filter(x => isAccount(x.l.compte, CGNC.CHARGES)).reduce((s, x) => s + x.debit, 0);
  const products = reportEntryLines().filter(x => isAccount(x.l.compte, CGNC.PRODUITS)).reduce((s, x) => s + x.credit, 0);
  const result = products - charges; const tax = Math.max(0, result * 0.20);
  renderStructuredReport("Détermination d'impôt", ['Indicateur','Montant'], [['Produits imposables', round2(products)], ['Charges déductibles', round2(charges)], ['Résultat fiscal estimé', round2(result)], ['IS estimé (20%)', round2(tax)]]);
}
function showPaymentDelaysReport() {
  const rows = reportEntryLines().filter(x => x.l.facture || x.e.n_facture).map(x => { const due = new Date(currentYear, Number(x.e.mois || 1) - 1, Number(x.e.jour || 1)); const days = Math.max(0, Math.floor((Date.now() - due) / 86400000)); return [x.l.facture || x.e.n_facture, entryDate(x.e), x.l.libelle || ACCOUNTS[x.l.compte] || '', days, days > 60 ? 'En retard' : 'Dans le délai']; });
  renderStructuredReport('Délais de Paiement', ['Facture','Date','Tiers','Jours écoulés','Statut'], rows);
}
function showProfessionalTaxReport() {
  const turnover = reportEntryLines().filter(x => isAccount(x.l.compte, CGNC.PRODUITS)).reduce((s, x) => s + x.credit, 0);
  renderStructuredReport('Taxe Professionnelle', ['Base taxable','Taux appliqué','Taxe estimée'], [[round2(turnover), '0,25 %', round2(turnover * 0.0025)]]);
}
function showFeesReport() {
  const rows = reportEntryLines().filter(x => /^61/.test(String(x.l.compte)) && /honoraire|avocat|conseil/i.test((x.l.libelle || '') + ' ' + (ACCOUNTS[x.l.compte] || ''))).map(x => [entryDate(x.e), x.l.libelle || ACCOUNTS[x.l.compte] || '', round2(x.debit), 'RAS à contrôler']);
  renderStructuredReport('Honoraires', ['Date','Bénéficiaire','Montant','RAS'], rows);
}

// ===== LIASSE FISCALE ENGINE =====
const LIASSE_TABLES = [
  ...Array.from({length:6}, (_, i) => ({table:'TABLEAU_1_BILAN_ACTIF', code:`BA-${String(i + 1).padStart(2,'0')}`, label:`Bilan Actif — rubrique ${i + 1}`, classes:[2,3], basis:'solde_debiteur'})),
  ...Array.from({length:6}, (_, i) => ({table:'TABLEAU_2_BILAN_PASSIF', code:`BP-${String(i + 1).padStart(2,'0')}`, label:`Bilan Passif — rubrique ${i + 1}`, classes:[1,4], basis:'solde_crediteur'})),
  ...Array.from({length:8}, (_, i) => ({table:'TABLEAU_3_CPC', code:`CPC-${String(i + 1).padStart(2,'0')}`, label:`CPC — rubrique ${i + 1}`, classes:[6,7], basis:i % 2 ? 'mouvement_credit' : 'mouvement_debit'})),
  ...Array.from({length:6}, (_, i) => ({table:'TABLEAU_5_ESG', code:`ESG-${String(i + 1).padStart(2,'0')}`, label:`ESG — solde ${i + 1}`, classes:[6,7], basis:'mouvement_debit'})),
  ...Array.from({length:3}, (_, i) => ({table:'TABLEAU_6_FINANCEMENT', code:`TF-${String(i + 1).padStart(2,'0')}`, label:`Tableau de Financement — rubrique ${i + 1}`, classes:[1,2], basis:'solde_crediteur'})),
  ...Array.from({length:3}, (_, i) => ({table:'TABLEAU_7_ETIC', code:`ETIC-${String(i + 1).padStart(2,'0')}`, label:`ETIC — rubrique ${i + 1}`, classes:[2,3,4], basis:'solde_debiteur'}))
];
const LIASSE_STATE_KEY = 'kompta_liasse_state_v1';
let liasseState = null;
function liasseBalanceRows() {
  return cgncAccounts(false).map(account => ({
    accountCode: account.code, label: ACCOUNTS[account.code] || '',
    openingDebit: account.anD, openingCredit: account.anC,
    movementDebit: account.mvD, movementCredit: account.mvC
  }));
}
function liasseClassForTable(definition, code) { return definition.classes.includes(Number(String(code).charAt(0))); }
function liasseAmount(definition, row) {
  const debit = Number(row.openingDebit || 0) + Number(row.movementDebit || 0);
  const credit = Number(row.openingCredit || 0) + Number(row.movementCredit || 0);
  if (definition.basis === 'solde_crediteur') return Math.max(0, credit - debit);
  if (definition.basis === 'mouvement_credit') return Number(row.movementCredit || 0);
  if (definition.basis === 'mouvement_debit') return Number(row.movementDebit || 0);
  return Math.max(0, debit - credit);
}
function liasseDefaultState() {
  return {
    fiscalYear: currentYear, identifiantFiscal: DATA.dossiers.find(d => d.id === currentClientId)?.identifiant_fiscal || '',
    adjustments: [
      { code:'REINTEGRATION_CHARGES_ND', label:'Charges non déductibles', amount:0, direction:'reintegrations' },
      { code:'REINTEGRATION_AMORTISSEMENT_VEHICULE', label:'Excédent amortissement véhicules', amount:0, direction:'reintegrations' },
      { code:'REINTEGRATION_ESPECES', label:'Dépenses en espèces au-delà du plafond', amount:0, direction:'reintegrations' },
      { code:'REINTEGRATION_PENALITES', label:'Pénalités et amendes', amount:0, direction:'reintegrations' },
      { code:'DEDUCTION_DIVIDENDES', label:'Dividendes reçus exonérés à 100%', amount:0, direction:'deductions' },
      { code:'DEDUCTION_PLUS_VALUE', label:'Exonération plus-value', amount:0, direction:'deductions' },
      { code:'DEDUCTION_DEFICITS', label:'Reports déficitaires antérieurs', amount:0, direction:'deductions' }
    ], creditAnterieur:0, acomptesIS:0, creditsFiscaux:0, cmRate:0.005, tables: {}
  };
}
function loadLiasseState() {
  try {
    const all = JSON.parse(localStorage.getItem(LIASSE_STATE_KEY) || '{}');
    liasseState = all[`${currentClientId}:${currentYear}`] || liasseDefaultState();
  } catch (error) {
    liasseState = liasseDefaultState();
    showToast('État Liasse illisible. Les valeurs par défaut sont affichées; la sauvegarde locale reste intacte.', 'error');
  }
}
function saveLiasseState() {
  try {
    const all = JSON.parse(localStorage.getItem(LIASSE_STATE_KEY) || '{}');
    all[`${currentClientId}:${currentYear}`] = liasseState;
    localStorage.setItem(LIASSE_STATE_KEY, JSON.stringify(all));
    showToast('État Liasse Fiscale enregistré dans ce navigateur ✓', 'success');
  } catch (error) {
    showToast('Échec de sauvegarde navigateur. Les valeurs restent affichées, mais ne survivront pas à la fermeture.', 'error');
  }
}
function liasseMappingRules() {
  return LIASSE_TABLES.map(definition => ({
    dgiCellCode: definition.code, label: definition.label, table: definition.table,
    selector: { accountPrefixes: definition.classes.map(String), cgncClass: definition.classes[0] },
    amountBasis: definition.basis, order: Number(definition.code.split('-')[1])
  }));
}
function renderLiasseTables() {
  const body = document.getElementById('liasse-tables-tab');
  const balance = liasseBalanceRows();
  const grouped = LIASSE_TABLES.map(definition => {
    const amount = balance.filter(row => liasseClassForTable(definition, row.accountCode)).reduce((sum, row) => sum + liasseAmount(definition, row), 0);
    const saved = liasseState.tables[definition.code];
    const savedAmount = typeof saved === 'object' ? saved.amount : (saved ?? round2(amount));
    const savedCode = typeof saved === 'object' ? saved.code : definition.code;
    return `<tr><td>${definition.table}</td><td><input value="${savedCode}" onchange="updateLiasseTable('${definition.code}','code',this.value)"></td><td>${definition.label}</td><td><input type="number" step="0.01" value="${savedAmount}" onchange="updateLiasseTable('${definition.code}','amount',this.value)" style="text-align:right;width:130px;"></td><td>${definition.classes.join(', ')}</td></tr>`;
  }).join('');
  body.innerHTML = `<div style="max-height:440px;overflow:auto;"><table><thead><tr><th>Tableau</th><th>Code DGI</th><th>Rubrique</th><th>Valeur</th><th>Classes CGNC</th></tr></thead><tbody>${grouped}</tbody></table></div>`;
}
function updateLiasseTable(code, key, value) {
  const existing = liasseState.tables[code];
  const entry = typeof existing === 'object' ? existing : { code, amount: Number(existing) || 0 };
  entry[key] = key === 'amount' ? Number(value) || 0 : String(value).trim() || code;
  liasseState.tables[code] = entry;
  saveLiasseState();
}
function renderLiasseAdjustments() {
  const body = document.getElementById('liasse-adjustments-tab');
  const balance = liasseBalanceRows();
  const charges = balance.filter(row => isAccount(row.accountCode, CGNC.CHARGES)).reduce((s, row) => s + Number(row.movementDebit || 0), 0);
  const products = balance.filter(row => isAccount(row.accountCode, CGNC.PRODUITS)).reduce((s, row) => s + Number(row.movementCredit || 0), 0);
  const accounting = round2(products - charges);
  const rows = liasseState.adjustments.map((item, index) => `<tr><td>${item.direction === 'reintegrations' ? 'Réintégration' : 'Déduction'}</td><td>${item.label}</td><td><input type="number" step="0.01" value="${item.amount}" onchange="updateLiasseAdjustment(${index},this.value)" style="width:130px;text-align:right;"></td></tr>`).join('');
  body.innerHTML = `<div class="card"><div class="ch"><h3>Tableau 03 — Passage au résultat fiscal</h3><span class="badge">Année ${currentYear}</span></div><table><thead><tr><th>Type</th><th>Motif</th><th>Montant</th></tr></thead><tbody><tr><td colspan="2"><strong>Résultat comptable</strong></td><td style="text-align:right;"><strong>${fmtFR(accounting)} MAD</strong></td></tr>${rows}<tr class="total-row"><td colspan="2"><strong>Résultat fiscal</strong></td><td style="text-align:right;"><strong id="liasse-fiscal-result">${fmtFR(accounting)} MAD</strong></td></tr></tbody></table></div>`;
}
function updateLiasseAdjustment(index, value) { liasseState.adjustments[index].amount = Number(value) || 0; renderLiasseAdjustments(); saveLiasseState(); }
function renderLiasseTax() {
  const body = document.getElementById('liasse-tax-tab');
  body.innerHTML = `<div class="card"><div class="ch"><h3>Tableau 04 — IS et Cotisation Minimale</h3></div><div class="form-row" style="padding:12px;"><div class="fg"><label>Acomptes IS</label><input type="number" id="liasse-acomptes" value="${liasseState.acomptesIS || 0}" onchange="liasseState.acomptesIS=Number(this.value)||0"></div><div class="fg"><label>Crédits fiscaux</label><input type="number" id="liasse-credits" value="${liasseState.creditsFiscaux || 0}" onchange="liasseState.creditsFiscaux=Number(this.value)||0"></div><div class="fg"><label>Taux CM</label><input type="number" step="0.001" id="liasse-cm-rate" value="${liasseState.cmRate}" onchange="liasseState.cmRate=Number(this.value)||0"></div></div><div id="liasse-tax-result" style="padding:12px;color:var(--muted);">Calcul backend disponible à l’export XML.</div></div>`;
}
function showLiasseTab(tab, button) {
  document.querySelectorAll('.liasse-tab').forEach(item => item.classList.remove('active'));
  if (button) button.classList.add('active');
  ['tables','adjustments','tax'].forEach(name => { const el = document.getElementById('liasse-' + name + '-tab'); if (el) el.style.display = name === tab ? 'block' : 'none'; });
}
function openLiasse() {
  loadLiasseState();
  document.getElementById('liasse-year-title').textContent = `${currentYear} — ${currentDossier?.name || currentClientId}`;
  renderLiasseTables(); renderLiasseAdjustments(); renderLiasseTax();
  showLiasseTab('tables', document.querySelector('.liasse-tab'));
  openModal('modalLiasse');
}
async function exportLiasseXml() {
  const balance = liasseBalanceRows();
  const request = { fiscalYear: currentYear, identifiantFiscal: liasseState.identifiantFiscal, balance, adjustments: liasseState.adjustments, creditAnterieur: liasseState.creditAnterieur || 0, acomptesIS: liasseState.acomptesIS || 0, creditsFiscaux: liasseState.creditsFiscaux || 0, cmRate: liasseState.cmRate, mappingRules: liasseMappingRules(), demoOnly: true };
  try {
    const response = await apiFetch(`${KOMPTA_API_BASE}/api/liasse/simpl-is.xml`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(request) });
    if (!response.ok) { showToast(await responseErrorMessage(response, 'Échec de l’export SIMPL-IS.'), 'error'); return; }
    const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `SIMPL_IS_${currentYear}.xml`; link.click(); URL.revokeObjectURL(url); saveLiasseState(); showToast('XML SIMPL-IS exporté.', 'success');
  } catch (error) { showToast(apiConnectionErrorMessage(error, 'Export SIMPL-IS'), 'error'); }
}
let cgncReportState = { type:'', headers:[], exportRows:[] };
const cgncMoney = value => `${fmtFR(value)} MAD`;
function cgncAccounts(includeDemo = true) {
  const totals = {};
  const add = (code, key, value) => { const t = totals[code] || (totals[code] = { code, anD:0, anC:0, mvD:0, mvC:0 }); t[key] += Number(value) || 0; };
  if (includeDemo) aNouveauxFor(currentYear).forEach(a => { add(a.code, 'anD', a.debit); add(a.code, 'anC', a.credit); });
  clientEntries().filter(e => e.year === currentYear && (includeDemo || !e.demoOnly)).forEach(e => e.lines.forEach(l => { add(l.compte, 'mvD', lineDebit(l)); add(l.compte, 'mvC', lineCredit(l)); }));
  return Object.values(totals).sort((a, b) => a.code.localeCompare(b.code));
}
function cgncFilterBar(html) { document.getElementById('cgnc-report-filters').innerHTML = `<div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;">${html}</div>`; }
function cgncSet(title, subtitle, headers, exportRows, body) {
  cgncReportState = { type:cgncReportState.type, headers, exportRows };
  document.getElementById('cgnc-report-title').textContent = title;
  document.getElementById('cgnc-report-subtitle').textContent = subtitle + ' — ' + (currentDossier?.name || currentClientId);
  body(); openModal('modalCgncReport');
}
function cgncTable(headers, rows, footer = '') {
  return `<table><thead><tr>${headers.map(h => `<th>${menuEscape(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(r => `<tr>${r.map((v, i) => `<td style="${typeof v === 'number' ? 'text-align:right;' : ''}">${typeof v === 'number' ? cgncMoney(v) : (typeof v === 'string' && v.startsWith('<button') ? v : menuEscape(v))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" style="text-align:center;color:var(--muted);padding:20px;">Aucune donnée</td></tr>`}${footer}</tbody></table>`;
}
function cgncGeneralBalanceTable(rows, footer = '') {
  const body = rows.length
    ? rows.map(row => `<tr>${row.map(value => `<td style="${typeof value === 'number' ? 'text-align:right;' : ''}">${typeof value === 'number' ? cgncMoney(value) : menuEscape(value)}</td>`).join('')}</tr>`).join('')
    : '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:20px;">Aucune donnée</td></tr>';
  return `<table class="cgnc-balance-table"><thead>
    <tr><th rowspan="2">N° COMPTE</th><th rowspan="2">INTITULÉ</th><th colspan="2">SOLDES AU DÉBUT D'EXERCICE</th><th colspan="2">MOUVEMENTS DE L'EXERCICE</th><th colspan="2">SOLDES FINAUX</th></tr>
    <tr><th>DÉBIT</th><th>CRÉDIT</th><th>DÉBIT</th><th>CRÉDIT</th><th>DÉBIT</th><th>CRÉDIT</th></tr>
  </thead><tbody>${body}${footer}</tbody></table>`;
}
const CGNC_BALANCE_LABEL_FALLBACKS = {
  '1111':'Capital social',
  '3421':'Clients',
  '5141':'Banque',
  '7111':'Ventes de marchandises'
};
function openGeneralBalanceReport() {
  cgncReportState.type = 'balance-generale';
  cgncFilterBar(`<div class="fg"><label>Compte de</label><input id="cgnc-account-from" placeholder="1000" style="width:90px;" oninput="renderGeneralBalanceReport()"></div><div class="fg"><label>Compte à</label><input id="cgnc-account-to" placeholder="8999" style="width:90px;" oninput="renderGeneralBalanceReport()"></div><div class="fg"><label>Période</label><select id="cgnc-period" onchange="renderGeneralBalanceReport()"><option value="all">Exercice ${currentYear}</option>${Array.from({length:12}, (_, i) => `<option value="${i + 1}">Mois ${String(i + 1).padStart(2,'0')}</option>`).join('')}</select></div><div class="fg"><label>Classe</label><select id="cgnc-class" onchange="renderGeneralBalanceReport()"><option value="all">1 à 8</option>${[1,2,3,4,5,6,7,8].map(i => `<option>${i}</option>`).join('')}</select></div>`);
  cgncSet('BALANCE GÉNÉRALE', 'Soldes initiaux, mouvements et soldes finaux', ['N° Compte','Intitulé','SI Débit','SI Crédit','Mvt Débit','Mvt Crédit','SF Débit','SF Crédit'], [], renderGeneralBalanceReport);
}
function renderGeneralBalanceReport() {
  const from = document.getElementById('cgnc-account-from')?.value.trim() || '';
  const to = document.getElementById('cgnc-account-to')?.value.trim() || '';
  const period = document.getElementById('cgnc-period')?.value || 'all';
  const cls = document.getElementById('cgnc-class')?.value || 'all';
  const officialLabels = new Map(PCM_HIERARCHY.map(account => [account.code, account.label]));
  const accounts = cgncAccounts().map(t => ({
    ...t,
    label: String(ACCOUNTS[t.code] || '').trim()
      || String(DATA.accounts.find(account => account.code === t.code && account.standard)?.label || '').trim()
      || String(officialLabels.get(t.code) || '').trim()
      || CGNC_BALANCE_LABEL_FALLBACKS[t.code]
      || ''
  })).filter(t => (!from || t.code >= from) && (!to || t.code <= to) && (cls === 'all' || t.code.startsWith(cls)));
  const rows = accounts.map(account => {
    const openingDebit = Number(account.anD) || 0;
    const openingCredit = Number(account.anC) || 0;
    let movementDebit = Number(account.mvD) || 0;
    let movementCredit = Number(account.mvC) || 0;
    if (period !== 'all') {
      movementDebit = 0;
      movementCredit = 0;
      clientEntries()
        .filter(entry => entry.year === currentYear && Number(entry.mois) === Number(period))
        .forEach(entry => entry.lines
          .filter(line => line.compte === account.code)
          .forEach(line => {
            movementDebit += lineDebit(line);
            movementCredit += lineCredit(line);
          }));
    }
    const net = round2(
      (openingDebit - openingCredit) + (movementDebit - movementCredit)
    );
    const finalDebit = net > 0 ? net : 0;
    const finalCredit = net < 0 ? Math.abs(net) : 0;
    return [
      account.code,
      account.label,
      openingDebit,
      openingCredit,
      movementDebit,
      movementCredit,
      finalDebit,
      finalCredit
    ];
  });
  const totals = rows.reduce((sums, row) => {
    for (let index = 0; index < sums.length; index++) {
      sums[index] += Number(row[index + 2]) || 0;
    }
    return sums;
  }, [0,0,0,0,0,0]).map(round2);
  const siDifference = round2(totals[0] - totals[1]);
  const sfDifference = round2(totals[4] - totals[5]);
  const footer = `<tr class="total-row"><td colspan="2"><strong>TOTAUX</strong></td>${totals.map(value => `<td style="text-align:right;"><strong>${cgncMoney(value)}</strong></td>`).join('')}</tr><tr><td colspan="2"><strong>Contrôle équilibre</strong></td><td colspan="3" style="text-align:right;">SI: ${cgncMoney(siDifference)}</td><td colspan="3" style="text-align:right;">SF: ${cgncMoney(sfDifference)}</td></tr>`;
  document.getElementById('cgnc-report-body').innerHTML = cgncGeneralBalanceTable(rows, footer);
  cgncReportState.exportRows = rows;
}
function invoiceDate(e) { const raw = e.dueDate || e.echeance || e.date; if (raw) return new Date(raw); return new Date(currentYear, Number(e.mois || 1) - 1, Number(e.jour || 1) + 30); }
function openAgedBalanceReport() {
  cgncReportState.type = 'aged-balance';
  const today = new Date();
  const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  cgncFilterBar(`<div class="fg"><label>Type de tiers</label><select id="cgnc-aging-type" onchange="renderAgedBalanceReport()"><option value="all">Clients + Fournisseurs</option><option value="client">Clients 3421</option><option value="supplier">Fournisseurs 4411</option></select></div><div class="fg"><label>Au</label><input id="cgnc-aging-date" type="date" value="${localDate}" onchange="renderAgedBalanceReport()"></div>`);
  cgncSet('LA BALANCE ÂGÉE', 'Créances clients et dettes fournisseurs par échéance', ['Code Tiers','Nom / Raison Sociale','Non Échu','0-30 Jours','31-60 Jours','61-90 Jours','+90 Jours','Total Dû'], [], renderAgedBalanceReport);
}
function renderAgedBalanceReport() {
  const type = document.getElementById('cgnc-aging-type')?.value || 'all';
  const dateInput = document.getElementById('cgnc-aging-date')?.value || '';
  const invoices = new Map();
  const payments = [];
  const isSettlementJournal = journal => /^(BANQUE|CAISSE|EFFETS|A ENCAISSER)$/i.test(String(journal || '').trim());
  const dayNumber = value => {
    const datePart = typeof value === 'string' && value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (datePart) return Date.UTC(Number(datePart[1]), Number(datePart[2]) - 1, Number(datePart[3])) / 86400000;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime())
      ? null
      : Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  };
  const asOfDay = dayNumber(dateInput || new Date());
  const entryDay = entry => entry.date
    ? dayNumber(entry.date)
    : dayNumber(`${entry.year}-${String(entry.mois || '').padStart(2, '0')}-${String(entry.jour || '').padStart(2, '0')}`);
  const entries = clientEntries()
    .map(entry => ({entry, day:entryDay(entry)}))
    .filter(item => item.day !== null && item.day <= asOfDay)
    .sort((left, right) => left.day - right.day)
    .map(item => item.entry);
  entries.forEach(entry => {
    entry.lines.forEach(line => {
      const code = String(line.compte || '').trim();
      const isClient = isAccount(code, CGNC.CLIENTS);
      const isSupplier = isAccount(code, CGNC.FOURNISSEURS);
      if ((!isClient && !isSupplier) || (type === 'client' && !isClient) || (type === 'supplier' && !isSupplier)) return;
      const reference = String(line.facture || entry.n_facture || '').trim();
      const normalizedAmount = isClient
        ? lineDebit(line) - lineCredit(line)
        : lineCredit(line) - lineDebit(line);
      const isInvoice = normalizedAmount > 0
        && !isSettlementJournal(entry.journal)
        && (Boolean(reference) || /^(ACHATS|VENTES)$/i.test(String(entry.journal || '').trim()));
      if (isInvoice) {
        const invoiceReference = reference || String(entry.piece || '').trim();
        if (!invoiceReference) return;
        const key = `${code}\u0000${invoiceReference}`;
        let invoice = invoices.get(key);
        if (!invoice) {
          const rawDueDate = line.dueDate || line.echeance || entry.dueDate || entry.echeance;
          const dueDate = rawDueDate || invoiceDate(entry);
          invoice = {
            code,
            name:ACCOUNTS[code] || line.libelle || '',
            reference:invoiceReference,
            issueDay:entryDay(entry),
            dueDay:dayNumber(dueDate),
            amount:0,
            outstanding:0,
            letters:new Set()
          };
          invoices.set(key, invoice);
        }
        invoice.amount += normalizedAmount;
        if (line.lettre) invoice.letters.add(String(line.lettre));
      } else {
        payments.push({
          code,
          reference,
          letter:line.lettre ? String(line.lettre) : '',
          day:entryDay(entry),
          amount:-normalizedAmount
        });
      }
    });
  });

  const byCode = new Map();
  const byReference = new Map();
  const byLetter = new Map();
  invoices.forEach(invoice => {
    invoice.amount = round2(invoice.amount);
    invoice.outstanding = Math.max(0, invoice.amount);
    if (invoice.outstanding <= 0) return;
    if (!byCode.has(invoice.code)) byCode.set(invoice.code, []);
    byCode.get(invoice.code).push(invoice);
    byReference.set(`${invoice.code}\u0000${invoice.reference}`, invoice);
    invoice.letters.forEach(letter => {
      const key = `${invoice.code}\u0000${letter}`;
      if (!byLetter.has(key)) byLetter.set(key, []);
      byLetter.get(key).push(invoice);
    });
  });
  const applyPayment = (amount, candidates) => {
    let remaining = Math.max(0, round2(amount));
    for (const invoice of candidates) {
      if (remaining <= 0) break;
      const applied = Math.min(invoice.outstanding, remaining);
      invoice.outstanding = round2(invoice.outstanding - applied);
      remaining = round2(remaining - applied);
    }
  };
  const invoiceOrder = (left, right) => left.issueDay - right.issueDay || left.reference.localeCompare(right.reference);
  byCode.forEach(list => list.sort(invoiceOrder));
  byLetter.forEach(list => list.sort(invoiceOrder));
  payments.forEach(payment => {
    if (payment.amount <= 0) return;
    const invoice = payment.reference
      ? byReference.get(`${payment.code}\u0000${payment.reference}`)
      : null;
    if (invoice) {
      applyPayment(payment.amount, [invoice]);
    } else if (payment.letter) {
      applyPayment(payment.amount, byLetter.get(`${payment.code}\u0000${payment.letter}`) || []);
    } else if (!payment.reference) {
      applyPayment(payment.amount, (byCode.get(payment.code) || []).filter(invoice => invoice.issueDay <= payment.day));
    }
  });

  const groups = new Map();
  byCode.forEach(list => list.forEach(invoice => {
    const amount = round2(invoice.outstanding);
    if (amount <= 0) return;
    const daysOverdue = asOfDay - invoice.dueDay;
    const bucket = daysOverdue <= 0 ? 0
      : daysOverdue <= 30 ? 1
      : daysOverdue <= 60 ? 2
      : daysOverdue <= 90 ? 3
      : 4;
    let group = groups.get(invoice.code);
    if (!group) {
      group = {code:invoice.code,name:invoice.name,buckets:[0,0,0,0,0]};
      groups.set(invoice.code, group);
    }
    group.buckets[bucket] = round2(group.buckets[bucket] + amount);
  }));
  const rows = [...groups.values()].map(group => [
    group.code,
    group.name,
    ...group.buckets,
    round2(group.buckets.reduce((sum, amount) => sum + amount, 0))
  ]);
  const headers = ['Code Tiers','Nom / Raison Sociale','Non Échu','0-30 Jours','31-60 Jours','61-90 Jours','+90 Jours','Total Dû'];
  const totals = headers.slice(2).map((_, index) => round2(rows.reduce((sum, row) => sum + (Number(row[index + 2]) || 0), 0)));
  const body = rows.length
    ? rows.map(row => `<tr>${row.map((value, index) => `<td${index >= 2 ? ' class="amount"' : ''}>${index >= 2 ? cgncMoney(Number(value) || 0) : menuEscape(value)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}" class="empty">Aucune donnée</td></tr>`;
  const footer = `<tfoot><tr class="total-row"><td colspan="2">TOTAUX</td>${totals.map(value => `<td class="amount">${cgncMoney(value)}</td>`).join('')}</tr></tfoot>`;
  document.getElementById('cgnc-report-body').innerHTML = `<table class="cgnc-aged-balance-table"><thead><tr>${headers.map(header => `<th>${menuEscape(header)}</th>`).join('')}</tr></thead><tbody>${body}</tbody>${footer}</table>`;
  cgncReportState.exportRows=rows;
}
function openJournalCgncReport(central) { cgncReportState.type=central?'journal-central':'journals'; cgncFilterBar(`<div class="fg"><label>Journal</label><select id="cgnc-journal-code" onchange="renderJournalCgncReport(${central})"><option value="all">Tous</option><option value="ACH">ACH</option><option value="VTE">VTE</option><option value="BQ">BQ</option><option value="CA">CA</option><option value="OD">OD</option></select></div>${central ? `<div class="fg"><label>Mois</label><select id="cgnc-journal-month" onchange="renderJournalCgncReport(true)"><option value="all">Tous les mois</option>${Array.from({length:12},(_,i)=>`<option value="${i+1}">${String(i+1).padStart(2,'0')}</option>`).join('')}</select></div>` : ''}`); cgncSet(central?'Journal Centralisateur CGNC':'Journaux CGNC',central?'Synthèse mensuelle et cumul annuel':'Détail chronologique des écritures',central?['Code Journal','Libellé','Total Débit Mois','Total Crédit Mois','Cumul Annuel']:['Date','Code Journal','Pièce','Libellé','Débit','Crédit'],[],() => renderJournalCgncReport(central)); }
function journalCode(name) { const n=String(name||'').toUpperCase(); return n.startsWith('ACH')?'ACH':n.startsWith('VEN')?'VTE':n.startsWith('BAN')?'BQ':n.startsWith('CAI')?'CA':'OD'; }
function renderJournalCgncReport(central) { const code=document.getElementById('cgnc-journal-code')?.value||'all'; const month=document.getElementById('cgnc-journal-month')?.value||'all'; const allEntries=menuRows().filter(e=>code==='all'||journalCode(e.journal)===code); const entries=central&&month!=='all'?allEntries.filter(e=>Number(e.mois)===Number(month)):allEntries; if (central) { const groups={}; entries.forEach(e=>{const c=journalCode(e.journal),g=groups[c]||(groups[c]={code:c,label:e.journal,d:0,cr:0,annual:0}); const d=e.lines.reduce((s,l)=>s+lineDebit(l),0),cr=e.lines.reduce((s,l)=>s+lineCredit(l),0); g.d+=d;g.cr+=cr;}); allEntries.forEach(e=>{const c=journalCode(e.journal),g=groups[c]||(groups[c]={code:c,label:e.journal,d:0,cr:0,annual:0}); g.annual+=e.lines.reduce((s,l)=>s+lineDebit(l)+lineCredit(l),0);}); const rows=Object.values(groups).map(g=>[g.code,g.label,round2(g.d),round2(g.cr),round2(g.annual)]); document.getElementById('cgnc-report-body').innerHTML=cgncTable(['Code Journal','Libellé','Total Débit Mois','Total Crédit Mois','Cumul Annuel'],rows); cgncReportState.exportRows=rows; return; } const rows=entries.map(e=>[entryDate(e),journalCode(e.journal),e.piece,e.libelle||'',round2(e.lines.reduce((s,l)=>s+lineDebit(l),0)),round2(e.lines.reduce((s,l)=>s+lineCredit(l),0))]); document.getElementById('cgnc-report-body').innerHTML=cgncTable(['Date','Code Journal','Pièce','Libellé','Débit','Crédit'],rows); cgncReportState.exportRows=rows; }
function openBilanCgncReport() { cgncReportState.type='bilan'; cgncFilterBar('<span class="badge">Calculé sur les soldes de l’exercice actif</span>'); cgncSet('Bilan CGNC Marocain','Actif / Passif',[],[],renderBilanCgncReport); }
function renderBilanCgncReport() { const data=cgncAccounts(); const sum=(prefix,side)=>round2(data.filter(t=>t.code.startsWith(prefix)).reduce((s,t)=>s+Math.max(0,(t.anD+t.mvD)-(t.anC+t.mvC))*(side==='d'?1:0)+Math.max(0,(t.anC+t.mvC)-(t.anD+t.mvD))*(side==='c'?1:0),0)); const actif=[['Immobilisé — Classe 2',sum('2','d'),0],['Circulant — Classe 3',sum('3','d'),0],['Trésorerie-Actif — Classe 51',sum('51','d'),0]]; const passif=[['Financement Permanent — Classe 1',sum('1','c')],['Passif Circulant — Classe 4',sum('4','c')],['Trésorerie-Passif — Classe 55',sum('55','c')]]; document.getElementById('cgnc-report-body').innerHTML=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;"><div class="card"><div class="ch"><h3>ACTIF</h3></div>${cgncTable(['Rubrique','Brut','Amort./Prov.','Net'],actif.map(r=>[r[0],r[1],r[2],round2(r[1]-r[2])]),`<tr class="total-row"><td>Total Actif</td><td colspan="2"></td><td style="text-align:right;">${cgncMoney(actif.reduce((s,r)=>s+r[1]-r[2],0))}</td></tr>`)}</div><div class="card"><div class="ch"><h3>PASSIF</h3></div>${cgncTable(['Rubrique','Net'],passif,`<tr class="total-row"><td>Total Passif</td><td style="text-align:right;">${cgncMoney(passif.reduce((s,r)=>s+r[1],0))}</td></tr>`)}</div></div>`; cgncReportState.exportRows=[...actif,...passif]; }
function openPaymentDelayCgncReport() { cgncReportState.type='payment-delays'; cgncFilterBar('<span class="badge">Loi 69-21 — seuil de retard calculé sur la date d’échéance</span>'); cgncSet('Délais de Paiement — Loi 69-21','Factures échues non lettrées',[],[],renderPaymentDelayCgncReport); }
function renderPaymentDelayCgncReport() { const today=new Date(); const rows=[]; clientEntries().filter(e=>e.year===currentYear && e.n_facture).forEach(e=>{const due=invoiceDate(e),days=Math.max(0,Math.floor((today-due)/86400000)); if(days<1)return; const client=e.lines.find(l=>isAccount(l.compte, CGNC.CLIENTS, CGNC.FOURNISSEURS)); if(!client)return; const amount=Math.abs(e.lines.reduce((s,l)=>s+lineDebit(l)-lineCredit(l),0)); rows.push([e.n_facture,client.compte,entryDate(e),due.toLocaleDateString('fr-FR'),days,days>60?'1,5 %':'1 %',amount]);}); document.getElementById('cgnc-report-body').innerHTML=cgncTable(['Facture','Code Tiers','Date','Échéance','Jours retard','Pénalité Loi 69-21','Montant dû'],rows); cgncReportState.exportRows=rows; }
const cgncRentalValues = {};
function openProfessionalTaxCgncReport() { cgncReportState.type='professional-tax'; cgncFilterBar('<span class="badge">Taux appliqué: 10 % de la valeur locative annuelle (simulation déclarative)</span>'); cgncSet('Taxe Professionnelle','Valeurs locatives et liquidation annuelle',[],[],renderProfessionalTaxCgncReport); }
function renderProfessionalTaxCgncReport() { const key=currentClientId; if (cgncRentalValues[key] == null) cgncRentalValues[key]=100000; const value=cgncRentalValues[key]; document.getElementById('cgnc-report-body').innerHTML=`<table><thead><tr><th>Établissement</th><th>Valeur locative annuelle</th><th>Taux</th><th>Taxe professionnelle estimée</th></tr></thead><tbody><tr><td>${menuEscape(currentDossier?.name || key)}</td><td><input type="number" min="0" value="${value}" style="text-align:right;" oninput="cgncRentalValues['${key}']=Number(this.value)||0;renderProfessionalTaxCgncReport()"> MAD</td><td>10 %</td><td style="text-align:right;font-weight:700;">${cgncMoney(value*0.10)}</td></tr></tbody></table>`; cgncReportState.exportRows=[[currentDossier?.name||key,value,'10 %',round2(value*0.10)]]; }
function openClientInvoicesCgncReport() { cgncReportState.type='client-invoices'; cgncFilterBar('<span class="badge">Ventes et comptes clients 3421 — statut calculé sur les règlements</span>'); cgncSet('Factures Clients','Suivi des ventes, règlements et remises',[],[],renderClientInvoicesCgncReport); }
function renderClientInvoicesCgncReport() { const rows=[]; clientEntries().filter(e=>e.year===currentYear && e.n_facture && e.journal==='VENTES').forEach(e=>{const line=e.lines.find(l=>isAccount(l.compte, CGNC.CLIENTS)); const gross=Math.abs(e.lines.reduce((s,l)=>s+lineDebit(l)-lineCredit(l),0)); const paid=clientEntries().filter(p=>p.year===currentYear && !p.n_facture && p.lines.some(l=>l.compte===line?.compte)).reduce((s,p)=>s+Math.abs(p.lines.reduce((a,l)=>a+lineCredit(l)-lineDebit(l),0)),0); const status=paid>=gross?'Payée':paid>0?'Partielle':'Non Payée'; rows.push([e.n_facture,entryDate(e),line?.compte||'',round2(gross),round2(Math.min(paid,gross)),status,`<button class="btn btn-xs btn-s" data-action="showToast('Remise préparée pour ${menuEscape(e.n_facture)}','success')">Remise</button>`]);}); document.getElementById('cgnc-report-body').innerHTML=cgncTable(['N° Facture','Date','Client','Montant TTC','Réglé','Statut','Action'],rows); cgncReportState.exportRows=rows.map(r=>r.slice(0,6)); }
function openHonorairesCgncReport() { cgncReportState.type='fees'; cgncFilterBar('<div class="fg"><label>Taux RAS</label><select id="cgnc-ras-rate" onchange="renderHonorairesCgncReport()"><option value="10">10 %</option><option value="15">15 %</option></select></div>'); cgncSet('Honoraires — Retenue à la Source','Avocats, experts-comptables et consultants',[],[],renderHonorairesCgncReport); }
function renderHonorairesCgncReport() { const rate=Number(document.getElementById('cgnc-ras-rate')?.value||10)/100; const rows=reportEntryLines().filter(x=>/^6136/.test(x.l.compte)||/honoraire|avocat|expert|consultant/i.test(x.l.libelle||'')).map(x=>{const gross=round2(x.debit);return [entryDate(x.e),x.l.libelle||ACCOUNTS[x.l.compte]||'',gross,round2(gross*rate),round2(gross*(1-rate))];}); document.getElementById('cgnc-report-body').innerHTML=cgncTable(['Date','Bénéficiaire','Brut','RAS','Net payé'],rows); cgncReportState.exportRows=rows; }
function openCgncReport(type) { if(type==='balance-generale')return openGeneralBalanceReport(); if(type==='aged-balance')return openAgedBalanceReport(); if(type==='journals')return openJournalCgncReport(false); if(type==='journal-central')return openJournalCgncReport(true); if(type==='bilan')return openBilanCgncReport(); if(type==='payment-delays')return openPaymentDelayCgncReport(); if(type==='professional-tax')return openProfessionalTaxCgncReport(); if(type==='client-invoices')return openClientInvoicesCgncReport(); if(type==='fees')return openHonorairesCgncReport(); }
function exportCgncReport(format) { const values=[cgncReportState.headers,...(cgncReportState.exportRows||[])].map(row=>row.map(v=>String(v).replace(/<[^>]*>/g,''))); if(format==='xlsx'&&window.XLSX){const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(values),'Etat CGNC');XLSX.writeFile(book,dossierFileName('etat_cgnc_'+currentYear+'.xlsx'));}else{const csv=values.map(row=>row.map(v=>`"${v.replace(/"/g,'""')}"`).join(';')).join('\r\n');const link=document.createElement('a');link.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));link.download=dossierFileName('etat_cgnc_'+currentYear+'.csv');link.click();URL.revokeObjectURL(link.href);}showToast('Etat CGNC exporté ✓','success'); }
function exportMenuReport() {
  const values = Array.isArray(menuReportRows[0]) ? menuReportRows : [['Date','Journal','Piece','Libelle','Debit','Credit'], ...menuReportRows.map(r => [r.date,r.journal,r.piece,r.libelle,r.debit,r.credit])];
  if (window.XLSX) { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(values), 'Rapport'); XLSX.writeFile(book, dossierFileName('rapport_' + currentYear + '.xlsx')); }
  else { const csv = values.map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], {type:'text/csv;charset=utf-8'})); link.download = dossierFileName('rapport_' + currentYear + '.csv'); link.click(); URL.revokeObjectURL(link.href); }
  showToast('Rapport exporté ✓', 'success');
}
function showJournalReport() { renderMenuReport('Journal des écritures', reportRowsFromEntries().sort((a, b) => a.journal.localeCompare(b.journal) || a.date.localeCompare(b.date))); }
function renderThirdPartyLedger() {
  showPanel('consultation');
  const view = document.getElementById('consult-view'); if (view) view.value = 'gl';
  const input = document.getElementById('consult-account'); if (input) input.value = '';
  AppState.grandLivreFilter = '';
  const body = document.getElementById('gl-body');
  if (!body) return;
  const header = body.closest('table')?.querySelector('thead tr');
  if (header) header.innerHTML = '<th>Compte</th><th>Raison sociale</th><th>Type</th><th>ICE</th><th>IF</th><th>Débit</th><th>Crédit</th><th>Solde</th><th>Lettr.</th>';
  const accounts = DATA.accounts
    .filter(account => {
      const code = String(account.code || '');
      return isAccount(code, CGNC.CLIENTS, CGNC.FOURNISSEURS) || Boolean(account.ice);
    })
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  document.getElementById('gl-title').textContent = 'Comptes Tiers — Clients et Fournisseurs';
  document.getElementById('gl-tag').textContent = `${accounts.length} compte(s)`;
  body.innerHTML = accounts.length
    ? accounts.map(account => {
      const code = menuEscape(account.code);
      const label = menuEscape(account.label || account.libelle || '');
      const type = account.parent === CGNC.CLIENTS || isAccount(account.code, CGNC.CLIENTS) ? 'Client' : 'Fournisseur';
      return `<tr><td>${code}</td><td>${label}</td><td>${type}</td><td>${menuEscape(account.ice || '—')}</td><td>${menuEscape(account.identifiant_fiscal || '—')}</td><td></td><td></td><td></td><td></td></tr>`;
    }).join('')
    : '<tr><td colspan="9" style="text-align:center;color:var(--muted);padding:20px;">Aucun compte auxiliaire client ou fournisseur.</td></tr>';
  showToast('Comptes tiers chargés depuis le plan comptable ✓', 'info');
}
function menuSetting(label) { showPanel('parametrage'); showToast(label + ' : configuration disponible dans Paramètres', 'info'); }
function handleMenuAction(action) {
  const reports = {'aged-balance':'LA BALANCE ÂGÉE','report-ledger':'Grand Livre','report-journals':'Journaux','central-journal':'Journal Centralisateur','balance-sheet':'Bilan','client-invoices':'Factures Clients','tax-determination':"Détermination d'impôt",'payment-delays':'Délais de Paiement','professional-tax':'Taxes Professionnel',fees:'Honoraires','lawyer-edi':'EDI des avocats'};
  if (action === 'new-dossier' || action === 'open-dossier') { showDossierScreen(); return; }
  if (action === 'quit') { if (window.confirm('Enregistrer l’état du dossier avant de quitter ?')) showToast('État du dossier conservé ✓', 'success'); showDossierScreen(); return; }
  if (action === 'guided-entry' || action === 'entry-template') { showPanel('saisie'); showToast(action === 'guided-entry' ? 'Saisie guidée activée' : 'Modèles de saisie prêts à utiliser', 'info'); return; }
  if (action === 'third-party-ledger') { renderThirdPartyLedger(); return; }
  if (action === 'journal-entries') { showJournalReport(); return; }
  if (action === 'simple-tva') { renderTVA(); openModal('modalTVA'); return; }
  if (action === 'import-export') { showPanel('traitement'); openAuxImport(); return; }
  if (action === 'renumber') { let next = 1; clientEntries().filter(e => e.year === currentYear).forEach(e => { if (!e.piece) e.piece = 'AUTO-' + String(next).padStart(3, '0'); next++; }); renderAll(); showToast('Numérotation des écritures terminée ✓', 'success'); return; }
  if (action === 'close-journals') { openMenuWorkflow('Clôture des journaux', '<div class="warn">Les journaux de l’exercice actif seront marqués comme contrôlés.</div><p style="font-size:12px;">Les écritures existantes restent inchangées.</p>', 'Confirmer', () => { closeModal('modalMenuWorkflow'); showToast('Journaux contrôlés ✓', 'success'); }); return; }
  if (action === 'auto-backup' || action === 'backup') { showToast('Sauvegarde du dossier effectuée ✓', 'success'); return; }
  if (action === 'auto-update' || action === 'update') { showToast('Mise à jour vérifiée : version actuelle ✓', 'success'); return; }
  if (action === 'aged-balance') { openCgncReport('aged-balance'); return; }
  if (action === 'report-ledger') { showPanel('consultation'); const ledgerView = document.getElementById('consult-view'); if (ledgerView) ledgerView.value = 'gl'; AppState.grandLivreFilter = ''; renderConsultation(); return; }
  if (action === 'report-journals') { openCgncReport('journals'); return; }
  if (action === 'central-journal') { openCgncReport('journal-central'); return; }
  if (action === 'balance-sheet') { openLiasse(); return; }
  if (action === 'client-invoices') { openCgncReport('client-invoices'); return; }
  if (action === 'tax-determination') { openLiasse(); showLiasseTab('adjustments', document.querySelectorAll('.liasse-tab')[1]); return; }
  if (action === 'payment-delays') { openCgncReport('payment-delays'); return; }
  if (action === 'professional-tax') { openCgncReport('professional-tax'); return; }
  if (action === 'fees') { openCgncReport('fees'); return; }
  if (action === 'lawyer-edi') { openMenuWorkflow('EDI des avocats', '<p style="font-size:12px;line-height:1.6;">Le dossier est prêt pour un export EDI. Aucun fichier avocat n’est en attente.</p>', 'Exporter EDI', () => { closeModal('modalMenuWorkflow'); showToast('Export EDI préparé ✓', 'success'); }); return; }
  if (reports[action]) { renderMenuReport(reports[action], reportRowsFromEntries()); return; }
  const settings = {journals:'Journaux',banks:'Banques','vat-coding':'Codage TVA','vat-rates':'Taux de TVA','payment-methods':'Modes de paiement','third-parties':'Tiers','fixed-assets':'Nature immobilisation',currencies:'Devises','exchange-rates':'Taux de changes','scheduled-entries':'Planification des écritures'};
  if (settings[action]) { menuSetting(settings[action]); return; }
  const workflows = {counters:['Les Compteurs','Pièces: <strong>262040</strong> · Factures: <strong>1042</strong>'],restore:['Restaurations','Simulation de restauration disponible.'],maintenance:['Maintenances','Contrôle d’intégrité du dossier.'],compact:['Compacter un dossier','Compaction effectuée sur une copie de travail.'],downloads:['Téléchargements','Aucun téléchargement en attente.'],license:['Activation de licence','<div class="fg"><label>Clé de licence</label><input id="license-key" placeholder="XXXX-XXXX-XXXX"></div>'],suggestions:['Vos Suggestions','<textarea style="width:100%;min-height:90px;padding:8px;border:1px solid var(--border);border-radius:6px;" placeholder="Votre suggestion..."></textarea>'],messaging:['Messageries','Aucune notification non lue.'],users:['Utilisateurs','Mourad — Comptable<br>Administrateur — Accès complet'],access:['Accès utilisateur','Comptable: saisie, consultation et états.<br>Administrateur: paramètres et clôtures.'],preferences:['Préférences utilisateur','<label style="display:flex;gap:8px;font-size:12px;"><input type="checkbox" checked> Afficher les confirmations</label>'],password:['Mot de passe','<div class="fg"><label>Nouveau mot de passe</label><input type="password"></div>']};
  if (workflows[action]) { const [title, body] = workflows[action]; openMenuWorkflow(title, `<p style="font-size:12px;line-height:1.6;">${body}</p>`, 'Valider', () => { closeModal('modalMenuWorkflow'); showToast(title + ' : opération terminée ✓', 'success'); }); }
}
document.addEventListener('keydown', event => {
  if (!event.ctrlKey || event.altKey || event.shiftKey) return;
  if (event.key.toLowerCase() === 'l') { event.preventDefault(); openLiasse(); }
  if (event.key.toLowerCase() === 'd') { event.preventDefault(); openLiasse(); showLiasseTab('adjustments', document.querySelectorAll('.liasse-tab')[1]); }
});
function editPcmLabel(code, newLabel) {
  if (isStandardAccount(code)) { showToast('Compte ' + code + ' du référentiel CGNC : intitulé non modifiable', 'error'); renderPlanComptable(); return; }
  const acc = DATA.accounts.find(a => a.code === code);
  if (!acc) return;
  acc.label = newLabel;
  ACCOUNTS[code] = newLabel;
  persistCustomizationState();
  showToast('Intitulé du compte ' + code + ' mis à jour ✓', 'success');
  renderAll();
}
function editPcmCode(oldCode, newCode, inputEl) {
  newCode = (newCode || '').trim();
  if (!newCode || newCode === oldCode) { if (inputEl) inputEl.value = oldCode; return; }
  if (isStandardAccount(oldCode)) {
    showToast('Compte ' + oldCode + ' du référentiel CGNC : code non modifiable', 'error');
    if (inputEl) inputEl.value = oldCode;
    return;
  }
  if (!cgncRoot(newCode)) {
    showToast('Le code ' + newCode + ' ne prolonge aucun compte du référentiel CGNC', 'error');
    if (inputEl) inputEl.value = oldCode;
    return;
  }
  if (DATA.accounts.some(a => a.code === newCode)) {
    showToast('Ce code de compte existe déjà', 'error');
    if (inputEl) inputEl.value = oldCode;
    return;
  }
  const acc = DATA.accounts.find(a => a.code === oldCode);
  if (!acc) return;
  delete ACCOUNTS[oldCode];
  acc.code = newCode;
  acc.classe = Number(String(newCode).charAt(0));
  const pcmAcc = window.PCM_MAROC?.find(a => a.code === oldCode);
  if (pcmAcc) { pcmAcc.code = newCode; pcmAcc.libelle = acc.label; pcmAcc.classe = acc.classe; pcmAcc.rubrique = newCode.slice(0, 2); pcmAcc.poste = newCode.slice(0, 3); }
  ACCOUNTS[newCode] = acc.label;
  persistCustomizationState();
  showToast('Code de compte modifié : ' + oldCode + ' → ' + newCode, 'success');
  renderPlanComptable();
  renderAll();
}
function deletePcmAccount(code) {
  if (isStandardAccount(code)) { showToast('Compte ' + code + ' du référentiel CGNC : suppression impossible', 'error'); return; }
  if (!window.confirm('Supprimer le compte ' + code + ' du plan comptable ?')) return;
  const idx = DATA.accounts.findIndex(a => a.code === code);
  if (idx === -1) return;
  DATA.accounts.splice(idx, 1);
  if (window.PCM_MAROC) window.PCM_MAROC = window.PCM_MAROC.filter(a => a.code !== code);
  delete ACCOUNTS[code];
  renderPlanComptable();
  showToast('Compte ' + code + ' supprimé du plan comptable ✓', 'success');
}
function addPcmAccount() {
  let code = window.prompt('Code du nouveau sous-compte CGNC (ex: 61251) :');
  code = (code || '').trim();
  if (!code) return;
  if (!/^\d{5,}$/.test(code) || !cgncRoot(code)) { showToast('Un nouveau compte doit prolonger un compte du référentiel CGNC (au moins 5 chiffres)', 'error'); return; }
  if (DATA.accounts.some(a => a.code === code)) { showToast('Ce code existe déjà', 'error'); return; }
  const label = window.prompt('Intitulé du compte :') || 'Nouveau compte';
  const acc = { code, label, type: 'divisionnaire', parent: cgncRoot(code), classe: Number(code.charAt(0)) };
  DATA.accounts.push(acc);
  ACCOUNTS[code] = label;
  persistCustomizationState();
  renderPlanComptable();
  showToast('Compte ' + code + ' ajouté au plan comptable ✓', 'success');
}

function switchYear(year, readOnly) {
  currentYear = year;
  syncState();
  loadPersistedJournalEntries(currentClientId, currentYear);
  document.querySelectorAll(".ex-item").forEach(e => e.classList.remove("active"));
  const el = document.getElementById("ex-" + year);
  if(el) el.classList.add("active");
  const banner = document.getElementById("readonly-banner");
  banner.style.display = readOnly ? "flex" : "none";
  if (readOnly) {
    const closed = CLOSED_DATES[year];
    banner.querySelector('span').innerHTML =
      `🔒 <strong>Mode lecture seule</strong> — Exercice ${year} clôturé${closed ? ' le ' + closed : ''}. Consultation uniquement, aucune modification possible.`;
  }
  const dossierName = currentDossier ? currentDossier.name : 'Dossier';
  document.getElementById("client-badge").textContent = dossierName + " — " + year;
  const yl = document.getElementById("recent-entries-year");
  if(yl) yl.textContent = "Exercice " + year;
  suggestPiece();
  renderAll();
  // disable saisie inputs if readonly
  document.querySelectorAll("#panel-saisie input, #panel-saisie select, #panel-saisie button:not(.btn-s)").forEach(el => {
    el.disabled = readOnly;
    el.style.opacity = readOnly ? "0.5" : "1";
  });
  // Closed exercise → Consultation (data or closure notice); active → Saisie.
  showPanel(readOnly ? "consultation" : "saisie");
}

// ===== TVA (déclaration data-driven) =====
function renderTVA() {
  const body = document.getElementById('tva-lines-body');
  const dossier = DATA.dossiers.find(x => x.id === currentClientId);
  const titleEl = document.getElementById('tva-modal-title');
  const subEl = document.getElementById('tva-modal-sub');
  if (titleEl) titleEl.textContent = 'Exercice ' + currentYear;
  if (subEl) subEl.textContent = dossier
    ? `Régime ${dossier.tva_regime} · ${dossier.tva_periodicite} — TVA calculée selon le régime du dossier.`
    : 'TVA calculée selon le régime du dossier.';
  const entries = clientEntries().filter(e => e.year === currentYear);
  const encaissement = dossier && dossier.tva_regime === 'Encaissement';
  // In régime encaissement, TVA is only due once a payment exists (BANQUE/CAISSE).
  const hasPayment = ['BANQUE', 'CAISSE'].some(j => entries.some(e => e.journal === j));
  let facturee = 0, recuperable = 0;
  const rows = [];
  entries.forEach(e => {
    e.lines.forEach(l => {
      const code = String(l.compte);
      const isFact = isAccount(code, CGNC.TVA_FACTUREE);
      const isRec = isAccount(code, CGNC.TVA_RECUPERABLE);
      if (!isFact && !isRec) return;
      const montant = isFact ? lineCredit(l) : lineDebit(l);
      if (montant === 0) return;
      let statut = 'Exigible';
      let compte = true;
      if (isFact && encaissement && !hasPayment) { statut = 'En attente règlement'; compte = false; }
      if (compte) { if (isFact) facturee += montant; else recuperable += montant; }
      const taux = l.tva ? l.tva + '%' : '20%';
      rows.push({ date: entryDate(e), journal: e.journal, fact: l.facture || e.n_facture || '—', lib: l.libelle || '', montant, taux, statut, isFact });
    });
  });
  if (body) {
    body.innerHTML = '';
    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:16px;">Aucune opération TVA pour l'exercice ${currentYear}</td></tr>`;
    } else {
      rows.forEach(r => {
        const badge = r.statut === 'Exigible'
          ? `<span class="status s-green">${r.statut}</span>`
          : `<span class="status s-yellow">${r.statut}</span>`;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${r.date}</td><td>${r.journal}</td><td>${factBadge(r.fact)}</td><td>${r.lib} ${r.isFact ? '(collectée)' : '(récup.)'}</td><td style="text-align:right;">${fmtFR(r.montant)}</td><td>${r.taux}</td><td>${badge}</td>`;
        body.appendChild(tr);
      });
    }
  }
  facturee = round2(facturee); recuperable = round2(recuperable);
  if (facturee === 0 && dossier?.demoChiffreAffaires) {
    const rate = dossier.demoTvaRate ?? (dossier.tva_regime === 'Exonéré' ? 0 : 20);
    facturee = round2(dossier.demoChiffreAffaires * rate / 100);
  }
  const nette = tvaPayable(facturee, recuperable);
  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setTxt('tva-facturee', fmtFR(facturee));
  setTxt('tva-recuperable', fmtFR(recuperable));
  setTxt('tva-nette', fmtFR(nette) + ' MAD');
}

// ===== LETTRAGE (comptes tiers 3421 · 4411) =====
let lettrageSelection = [];
function renderLettrage() {
  const body = document.getElementById('lettrage-body');
  if (!body) return;
  lettrageSelection = [];
  body.innerHTML = '';
  const items = [];
  clientEntries().filter(e => e.year === currentYear).forEach(e => {
    e.lines.forEach((l, li) => {
      const code = String(l.compte);
      const isTiers = isAccount(code, CGNC.CLIENTS, CGNC.FOURNISSEURS);
      if (isTiers && !l.lettre) items.push({ e, l, key: e.piece + '#' + li });
    });
  });
  if (!items.length) {
    body.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:16px;">Aucune ligne à lettrer pour l'exercice ${currentYear}</td></tr>`;
    updateLettrageSolde();
    return;
  }
  items.forEach((it, i) => {
    const d = lineDebit(it.l), c = lineCredit(it.l);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${entryDate(it.e)}</td><td>${it.e.piece}</td><td>${it.l.compte}</td><td>${it.l.libelle||''}</td><td style="text-align:right;">${d ? fmtFR(d) : '—'}</td><td style="text-align:right;">${c ? fmtFR(c) : '—'}</td><td style="text-align:center;"><input type="checkbox" data-idx="${i}" onchange="toggleLettrage(this)"></td>`;
    body.appendChild(tr);
  });
  // Stash items for validation
  renderLettrage._items = items;
  updateLettrageSolde();
}
function toggleLettrage(cb) {
  const idx = parseInt(cb.dataset.idx, 10);
  if (cb.checked) lettrageSelection.push(idx);
  else lettrageSelection = lettrageSelection.filter(x => x !== idx);
  updateLettrageSolde();
}
function updateLettrageSolde() {
  const items = renderLettrage._items || [];
  let solde = 0;
  lettrageSelection.forEach(i => { solde += lineDebit(items[i].l) - lineCredit(items[i].l); });
  solde = round2(solde);
  const el = document.getElementById('lettrage-solde');
  const btn = document.getElementById('lettrage-valider');
  const balanced = Math.abs(solde) < 0.005 && lettrageSelection.length > 0;
  if (el) {
    el.textContent = balanced ? '0,00 ✓' : fmtFR(Math.abs(solde)) + (solde >= 0 ? ' D' : ' C');
    el.style.color = balanced ? 'var(--success)' : 'var(--danger)';
  }
  if (btn) btn.disabled = !balanced;
}
function validerLettrage() {
  const items = renderLettrage._items || [];
  if (!lettrageSelection.length) return;
  const lettre = nextLettre();
  lettrageSelection.forEach(i => { items[i].l.lettre = lettre; });
  closeModal('modalLettrage');
  renderAll();
  showToast('Lettrage ' + lettre + ' validé ✓', 'success');
}

// ===== CLÔTURE (pré-checks + génération à-nouveaux N+1) =====
function renderCloture() {
  const dossier = DATA.dossiers.find(x => x.id === currentClientId);
  const titleEl = document.getElementById('cloture-title');
  if (titleEl) titleEl.textContent = 'Clôture Exercice ' + currentYear;
  const checks = clotureChecks();
  const warn = document.getElementById('cloture-warn');
  if (warn) warn.innerHTML = `⚠️ La clôture va verrouiller l'exercice ${currentYear} et générer les À-nouveaux de l'exercice ${currentYear + 1} automatiquement.`;
  const box = document.getElementById('cloture-checks');
  if (box) {
    box.innerHTML = '';
    checks.list.forEach(c => {
      const div = document.createElement('div');
      const icon = c.ok ? '✅' : (c.warn ? '⚠️' : '❌');
      const color = c.ok ? 'var(--success)' : (c.warn ? 'var(--warning)' : 'var(--danger)');
      div.style.color = color;
      div.innerHTML = `${icon} ${c.label}`;
      box.appendChild(div);
    });
  }
}
function clotureChecks() {
  const entries = clientEntries().filter(e => e.year === currentYear);
  // Balance équilibrée
  let totD = 0, totC = 0;
  aNouveauxFor(currentYear).forEach(a => { totD += a.debit || 0; totC += a.credit || 0; });
  entries.forEach(e => e.lines.forEach(l => { totD += lineDebit(l); totC += lineCredit(l); }));
  const balanced = Math.abs(round2(totD - totC)) < 0.005;
  // N° Facture présent sur écritures ventes/achats
  const missingFact = entries.some(e => (e.journal === 'VENTES' || e.journal === 'ACHATS') && !e.n_facture && !e.lines.some(l => l.facture));
  // Lignes non lettrées (avertissement)
  let unlettered = 0;
  entries.forEach(e => e.lines.forEach(l => {
    const code = String(l.compte);
    if (isAccount(code, CGNC.CLIENTS, CGNC.FOURNISSEURS) && !l.lettre) unlettered++;
  }));
  const list = [
    { label: 'Balance équilibrée (Débit = Crédit)', ok: balanced, warn: false },
    { label: 'N° Facture renseigné sur les écritures Ventes/Achats', ok: !missingFact, warn: false },
    { label: unlettered ? `${unlettered} ligne(s) non lettrée(s)` : 'Toutes les lignes tiers lettrées', ok: unlettered === 0, warn: unlettered > 0 }
  ];
  const blocking = !balanced || missingFact;
  return { list, blocking };
}
function confirmerCloture() {
  const check = clotureChecks();
  if (check.blocking) {
    showToast('✗ Clôture impossible — corrigez les vérifications bloquantes', 'error');
    return;
  }
  const client = currentClient();
  // Compute final soldes per account (à-nouveaux + mouvements)
  const totals = {};
  const touch = a => { if (!totals[a]) totals[a] = 0; return a; };
  aNouveauxFor(currentYear).forEach(a => { touch(a.code); totals[a.code] += (a.debit || 0) - (a.credit || 0); });
  clientEntries().filter(e => e.year === currentYear).forEach(e => e.lines.forEach(l => {
    touch(l.compte); totals[l.compte] += lineDebit(l) - lineCredit(l);
  }));
  // Generate N+1 à-nouveaux from balance-sheet accounts (classes 1-5)
  const nextYear = currentYear + 1;
  const nextAnv = [];
  Object.keys(totals).forEach(code => {
    const cl = code.charAt(0);
    if (['1', '2', '3', '4', '5'].includes(cl)) {
      const solde = round2(totals[code]);
      if (Math.abs(solde) < 0.005) return;
      nextAnv.push({ code, debit: solde > 0 ? solde : 0, credit: solde < 0 ? -solde : 0 });
    }
  });
  client.a_nouveaux_by_year[nextYear] = nextAnv;
  // Mark exercise status
  client.exercise_status = client.exercise_status || {};
  client.exercise_status[currentYear] = { status: 'closed', closed_on: new Date().toLocaleDateString('fr-FR') };
  client.exercise_status[nextYear] = { status: 'open' };
  CLOSED_DATES[currentYear] = new Date().toLocaleDateString('fr-FR');
  const closedYear = currentYear;
  closeModal('modalCloture');
  // Switch to the new exercise
  currentYear = nextYear;
  syncState();
  document.querySelectorAll('.ex-item').forEach(e => e.classList.remove('active'));
  document.getElementById('ex-' + nextYear)?.classList.add('active');
  const dossierName = currentDossier ? currentDossier.name : 'Dossier';
  document.getElementById('client-badge').textContent = dossierName + ' — ' + nextYear;
  renderAll();
  showToast(`Exercice ${closedYear} clôturé — À-nouveaux ${nextYear} générés ✓`, 'success');
}

// ===== OCR intake and review (OCR is untrusted and never posts directly) =====
function selectOcrFile(event) {
  event?.preventDefault();
  event?.stopPropagation();
  document.getElementById('ocr-file-input')?.click();
}
function setOcrState(message, type = 'info') {
  const state = document.getElementById('ocr-state');
  if (!state) return;
  state.style.display = '';
  state.textContent = message;
  state.style.background = type === 'error' ? '#FEE2E2' : '#EEF2FF';
  state.style.color = type === 'error' ? 'var(--danger)' : 'var(--primary)';
}
function resetOcrReview() {
  document.getElementById('ocr-review')?.classList.remove('open');
  const button = document.getElementById('ocr-review-button');
  if (button) button.disabled = true;
  const state = document.getElementById('ocr-state');
  if (state) state.style.display = 'none';
  ['ocr-supplier', 'ocr-ice', 'ocr-invoice', 'ocr-date', 'ocr-ht', 'ocr-vat', 'ocr-vat-rate', 'ocr-ttc', 'ocr-expense-account', 'ocr-supplier-account'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}
function formatReviewDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate || '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (isoDate || '');
}
async function uploadOcrFile(file) {
  if (!file) return;
  resetOcrReview();
  setOcrState('Document en cours de validation et extraction...', 'info');
  try {
    const headers = {
      'Content-Type': file.type,
      'X-Kompta-Client-Id': currentClientId,
      'X-Kompta-Year': String(currentYear),
      'X-Kompta-Filename': file.name
    };
    if (currentDossier?.ice) {
      headers['X-Kompta-Client-Ice'] = currentDossier.ice;
    }
    const response = await apiFetch(`${KOMPTA_API_BASE}/api/ocr/documents`, {
      method: 'POST',
      body: file,
      headers: headers
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail?.message || 'Document refusé');
    currentOcrDocId = payload.documentId;

    const ext = payload.extractedData;
    if (ext) {
      if (ext.supplier) document.getElementById('ocr-supplier').value = ext.supplier;
      if (ext.ice) document.getElementById('ocr-ice').value = ext.ice;
      if (ext.invoiceNumber) document.getElementById('ocr-invoice').value = ext.invoiceNumber;
      if (ext.date) document.getElementById('ocr-date').value = formatReviewDate(ext.date);
      if (ext.ht != null) document.getElementById('ocr-ht').value = ext.ht.toFixed(2);
      if (ext.vat != null) document.getElementById('ocr-vat').value = ext.vat.toFixed(2);
      if (ext.vatRate != null) document.getElementById('ocr-vat-rate').value = ext.vatRate;
      if (ext.ttc != null) document.getElementById('ocr-ttc').value = ext.ttc.toFixed(2);

      // Pre-suggest standard expense and supplier accounts if empty
      const expAcct = document.getElementById('ocr-expense-account');
      if (expAcct && !expAcct.value) expAcct.value = '6122'; // Fournitures de bureau consommables
      const suppAcct = document.getElementById('ocr-supplier-account');
      if (suppAcct && !suppAcct.value) suppAcct.value = '4411'; // Fournisseurs
    }

    let msg = '';
    let msgType = 'info';
    if (payload.status === 'duplicate_suspected') {
      msg = 'Doublon potentiel : un document identique existe déjà dans ce dossier.';
      msgType = 'warning';
    } else if (ext && (ext.ht != null || ext.supplier || ext.invoiceNumber)) {
      msg = 'Données extraites automatiquement. Veuillez vérifier et sélectionner les comptes avant de valider.';
      msgType = 'info';
    } else {
      msg = 'Document conservé. Aucun texte vectoriel détecté (document scanné ou image) : saisie manuelle requise.';
      msgType = 'info';
    }
    setOcrState(msg, msgType);
    document.getElementById('ocr-review')?.classList.add('open');
    document.getElementById('ocr-review-button').disabled = false;
  } catch (error) {
    setOcrState(apiConnectionErrorMessage(error, 'Import OCR'), 'error');
  }
}
function createOcrEntry() {
  const supplier = document.getElementById('ocr-supplier').value.trim();
  const invoice = document.getElementById('ocr-invoice').value.trim();
  const expenseAccount = document.getElementById('ocr-expense-account').value.trim();
  const supplierAccount = document.getElementById('ocr-supplier-account').value.trim();
  const ht = parseFloat(document.getElementById('ocr-ht').value);
  const vat = parseFloat(document.getElementById('ocr-vat').value);
  const rateVal = parseFloat(document.getElementById('ocr-vat-rate').value) || 20;
  const ttc = parseFloat(document.getElementById('ocr-ttc').value);
  if (!currentOcrDocId || !supplier || !invoice || !expenseAccount || !supplierAccount || !Number.isFinite(ht) || !Number.isFinite(vat) || !Number.isFinite(ttc)) {
    setOcrState('Fournisseur, facture, comptes et montants sont obligatoires.', 'error');
    return;
  }
  if (Math.abs(round2(ht + vat) - round2(ttc)) >= 0.005) {
    setOcrState('Montants incohérents : HT + TVA doit être égal au TTC.', 'error');
    return;
  }
  closeModal('modalOCR');
  showPanel('saisie');
  document.getElementById('saisie-journal').value = 'ACHATS';
  suggestPiece();
  document.getElementById('saisie-ref').value = invoice;
  document.getElementById('saisie-libelle').value = `Facture ${supplier}`;
  prevHeaderLib = `Facture ${supplier}`;

  const tvaAccountMap = { 7:'3455207', 10:'3455210', 14:'3455214', 20:'3455220' };
  const vatAccount = tvaAccountMap[Math.round(rateVal)] || '3455220';

  const entryLines = [[expenseAccount, ht, false]];
  if (vat > 0) {
    entryLines.push([vatAccount, vat, false]);
  }
  entryLines.push([supplierAccount, ttc, true]);

  const tb = document.getElementById('lines-body');
  tb.innerHTML = '';
  entryLines.forEach(([account, amount, credit]) => {
    addLine();
    const tr = tb.rows[tb.rows.length - 1];
    const accountInput = tr.querySelector('.account-cell');
    accountInput.value = account;
    lookupAccount(accountInput);
    tr.dataset.lineLabel = `Facture ${supplier}`;
    tr.querySelector(credit ? '.credit-input' : '.debit-input').value = amount.toFixed(2);
  });
  computeTotals();
  setOcrState('Brouillon préparé dans la saisie. Validez-le via le workflow comptable existant.');
  showToast('Brouillon OCR préparé — confirmation comptable obligatoire', 'info');
}

document.getElementById('ocr-drop-zone')?.addEventListener('click', event => selectOcrFile(event));
document.getElementById('ocr-file-input')?.addEventListener('change', event => {
  event.stopPropagation();
  uploadOcrFile(event.target.files[0]);
});
document.getElementById('ocr-drop-zone')?.addEventListener('dragover', event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.classList.add('dragover'); });
document.getElementById('ocr-drop-zone')?.addEventListener('dragleave', event => { event.stopPropagation(); event.currentTarget.classList.remove('dragover'); });
document.getElementById('ocr-drop-zone')?.addEventListener('drop', event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.classList.remove('dragover'); uploadOcrFile(event.dataTransfer.files[0]); });

// Replace the demo-only dossier list with clearly separated real and demo sections.
function renderDossierScreen() {
  const grid = document.getElementById('dossier-grid');
  const searchEl = document.getElementById('dossier-search');
  const q = (searchEl ? searchEl.value : '').trim().toLowerCase();
  grid.innerHTML = '';
  const matches = DATA.dossiers
    .filter(d => !q || d.name.toLowerCase().includes(q) || String(d.ice).toLowerCase().includes(q))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!matches.length) {
    grid.innerHTML = `<div class="ds-empty">Aucun client ou société ne correspond à « ${menuEscape(q)} »</div>`;
    return;
  }
  const addSection = (title, records, demo) => {
    if (!records.length) return;
    const heading = document.createElement('div');
    heading.style.cssText = 'font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin:10px 2px 2px;';
    heading.textContent = title;
    grid.appendChild(heading);
    records.forEach(d => {
      const card = document.createElement('div');
      card.className = 'ds-card';
      card.innerHTML = `<div class="ds-avatar" style="background:${avatarColor(d.id)};">${initials(d.name)}</div>`
        + `<div class="ds-card-body"><div class="ds-name">${menuEscape(d.name)} ${demo ? '<span class="status s-gray">Démo</span>' : '<span class="status s-green">Réel</span>'}</div><div class="ds-meta">${menuEscape(d.forme)} · ICE ${menuEscape(d.ice)} · TVA ${menuEscape(d.tva_regime)} · ${menuEscape(d.tva_periodicite)}</div></div>`
        + `<span class="ds-ex">${d.exercice ? `Exercice ${d.exercice}` : 'Exercice à configurer'}</span>`;
      card.onclick = () => previewClient(d);
      grid.appendChild(card);
    });
  };
  addSection('Clients réels', matches.filter(d => d.isDemo === false), false);
  addSection('Données de démonstration', matches.filter(d => d.isDemo !== false), true);
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  loadCustomizationState();
  loadCgncChart();
  addLine();
  addLine();
  suggestPiece();
  computeTotals();
  renderAll();
  renderDossierScreen();
  loadManagedClients();
  renderPlanComptable();
  loadPersistedJournalEntries(currentClientId, currentYear);
});

// ===== DATA-ACTION DISPATCH =====
function printPage() { window.print(); }
function scrollToOcrQueue() { document.getElementById('ocr-queue-card').scrollIntoView({ behavior:'smooth', block:'start' }); }
function openBalanceConsultation() {
  showPanel('consultation');
  const view = document.getElementById('consult-view');
  if (view) { view.value = 'balance'; renderConsultation(); }
}
function toggleSwitch(element) { element.classList.toggle('on'); }
function openAuxFilePicker() { document.getElementById('aux-file').click(); }

const ACTION_THIS = Symbol('this');
const ACTION_EVENT = Symbol('event');
const ACTION_KEYWORDS = { true: true, false: false, null: null, this: ACTION_THIS, event: ACTION_EVENT };
// Accepts only `fn(literal, ...)` calls separated by `;`, so markup can never evaluate arbitrary code.
function parseActionCalls(source) {
  const token = /\s*(?:([A-Za-z_$][\w$]*)|'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?)|([(),;]))\s*/y;
  const unescape = text => text.replace(/\\(.)/g, (_, c) => ({ n:'\n', t:'\t' })[c] ?? c);
  const tokens = [];
  const text = source.trim();
  while (token.lastIndex < text.length) {
    const m = token.exec(text);
    if (!m) return null;
    if (m[1] !== undefined) tokens.push({ name: m[1] });
    else if (m[5] !== undefined) tokens.push({ punct: m[5] });
    else tokens.push({ value: m[2] !== undefined ? unescape(m[2]) : m[3] !== undefined ? unescape(m[3]) : Number(m[4]) });
  }
  const calls = [];
  let i = 0;
  while (i < tokens.length) {
    const name = tokens[i++]?.name;
    if (!name || tokens[i++]?.punct !== '(') return null;
    const args = [];
    while (tokens[i]?.punct !== ')') {
      const arg = tokens[i++];
      if (!arg) return null;
      if ('value' in arg) args.push(arg.value);
      else if (arg.name in ACTION_KEYWORDS) args.push(ACTION_KEYWORDS[arg.name]);
      else return null;
      if (tokens[i]?.punct === ',') i++;
      else if (tokens[i]?.punct !== ')') return null;
    }
    i++;
    calls.push({ name, args });
    if (tokens[i]?.punct === ';') i++;
    else if (i < tokens.length) return null;
  }
  return calls;
}
function runDataAction(target, event) {
  const calls = parseActionCalls(target.dataset.action || '');
  if (!calls) { console.error('data-action ignorée (syntaxe non prise en charge):', target.dataset.action); return; }
  for (const { name, args } of calls) {
    const fn = window[name];
    if (typeof fn !== 'function' || /\[native code\]/.test(Function.prototype.toString.call(fn))) {
      console.error('data-action ignorée (fonction inconnue):', name);
      return;
    }
    fn(...args.map(arg => arg === ACTION_THIS ? target : arg === ACTION_EVENT ? event : arg));
  }
}

// Centralized click handling keeps markup declarative and works on touch devices.
document.addEventListener('click', event => {
  const menuItem = event.target.closest('.mb-item');
  const menuButton = event.target.closest('.mb-btn');
  const actionTarget = event.target.closest('[data-action]');

  if (menuButton && menuItem) {
    event.preventDefault();
    document.querySelectorAll('.mb-item.open').forEach(item => {
      if (item !== menuItem) item.classList.remove('open');
    });
    menuItem.classList.toggle('open');
  }

  if (actionTarget && !actionTarget.disabled) {
    runDataAction(actionTarget, event);
    if (!actionTarget.classList.contains('mb-btn')) {
      actionTarget.closest('.mb-item')?.classList.remove('open');
    }
  }

  if (!menuItem && !event.target.closest('.dropdown')) {
    document.querySelectorAll('.mb-item.open').forEach(item => item.classList.remove('open'));
  }
});
