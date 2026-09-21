import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_NOW';
const DB_FILE = path.join(__dirname, 'data.json');
const app = express();
app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'public')));

function readDb(){
  if(!fs.existsSync(DB_FILE)) return {reports:[],users:[]};
  return JSON.parse(fs.readFileSync(DB_FILE,'utf8'));
}
function writeDb(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2)); }
function nextTicket(db){
  const n=db.reports.reduce((m,r)=>Math.max(m, Number(String(r.ticket).replace(/\D/g,''))||0),0)+1;
  return '#'+String(n).padStart(3,'0');
}
function safeUser(u){ return {id:u.id,role:u.role,nom:u.nom,email:u.email,active:u.active,createdAt:u.createdAt}; }
function auth(req,res,next){
  const h=req.headers.authorization||'';
  const token=h.startsWith('Bearer ')?h.slice(7):'';
  try{ req.user=jwt.verify(token,JWT_SECRET); next(); }
  catch{ res.status(401).json({error:'Authentification requise'}); }
}
function adminOnly(req,res,next){ if(req.user.role!=='admin') return res.status(403).json({error:'Accès administrateur requis'}); next(); }
async function notify(report){
  const url=process.env.NOTIFY_WEBHOOK_URL;
  if(!url) return {sent:false,reason:'NOTIFY_WEBHOOK_URL non configuré'};
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),8000);
  try{
    const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({event:'new_report',report}),signal:controller.signal});
    return {sent:r.ok,status:r.status};
  }catch(e){ return {sent:false,reason:e.message}; }
  finally{ clearTimeout(timer); }
}

// Initialisation sécurisée : mots de passe hachés, jamais envoyés au navigateur.
if(!fs.existsSync(DB_FILE)){
  const now=new Date().toISOString();
  const db={reports:[],users:[
    {id:'a1',role:'admin',nom:'Admin Principal',email:'admin@vigilbleu.com',passwordHash:bcrypt.hashSync('Admin1234',12),active:true,createdAt:now},
    {id:'s1',role:'superviseur',nom:'Sarah Diop',email:'sarah.diop@eau.sn',passwordHash:bcrypt.hashSync('1234',12),active:true,createdAt:now}
  ]};
  writeDb(db);
}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'Vigil Bleu API'}));

app.post('/api/auth/login',async(req,res)=>{
  const {email,password}=req.body||{}; const db=readDb();
  const u=db.users.find(x=>x.email.toLowerCase()===(email||'').trim().toLowerCase() && x.active);
  if(!u || !(await bcrypt.compare(password||'',u.passwordHash))) return res.status(401).json({error:'Compte introuvable ou mot de passe incorrect.'});
  const token=jwt.sign({id:u.id,role:u.role,nom:u.nom,email:u.email},JWT_SECRET,{expiresIn:'8h'});
  res.json({token,user:safeUser(u)});
});

app.get('/api/reports',auth,(req,res)=>res.json(readDb().reports));

app.post('/api/reports',async(req,res)=>{
  const b=req.body||{};
  if(!b.type || !b.typeLabel) return res.status(400).json({error:'Type de panne requis'});
  const lat=b.lat===null||b.lat===undefined?null:Number(b.lat), lng=b.lng===null||b.lng===undefined?null:Number(b.lng);
  if((lat!==null && !Number.isFinite(lat)) || (lng!==null && !Number.isFinite(lng))) return res.status(400).json({error:'Coordonnées GPS invalides'});
  const db=readDb();
  // Doublon côté serveur : plus fiable que le seul navigateur.
  if(lat!==null && lng!==null){
    const R=6371000, rad=x=>x*Math.PI/180;
    const distance=(a,b,c,d)=>{const da=rad(c-a),dbb=rad(d-b);const x=Math.sin(da/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(dbb/2)**2;return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));};
    const dup=db.reports.find(r=>r.status!=='regle'&&Number.isFinite(r.lat)&&Number.isFinite(r.lng)&&distance(lat,lng,r.lat,r.lng)<100);
    if(dup && !b.forceDuplicate) return res.status(409).json({duplicate:dup,error:'Une panne active est déjà signalée à moins de 100 m.'});
  }
  const report={id:crypto.randomUUID(),ticket:nextTicket(db),type:b.type,typeLabel:String(b.typeLabel).slice(0,120),typeIco:String(b.typeIco||'💧').slice(0,8),quartier:String(b.quartier||'Quartier non précisé').slice(0,160),notes:String(b.notes||'').slice(0,1000),lat,lng,status:'recu',date:new Date().toISOString(),actions:[]};
  db.reports.push(report); writeDb(db);
  const notification=await notify(report);
  res.status(201).json({report,notification});
});

app.patch('/api/reports/:ticket/status',auth,(req,res)=>{
  const {status}=req.body||{}; if(!['recu','cours','regle'].includes(status)) return res.status(400).json({error:'Statut invalide'});
  const db=readDb(); const r=db.reports.find(x=>x.ticket===req.params.ticket); if(!r) return res.status(404).json({error:'Ticket introuvable'});
  r.status=status; if(status==='regle') r.dateResolved=new Date().toISOString();
  if(!r.actions) r.actions=[]; r.actions.push({by:req.user.nom,action:status==='recu'?'Reçu':status==='cours'?'En cours':'Réglée',at:new Date().toISOString()});
  writeDb(db); res.json(r);
});

app.get('/api/admin/accounts',auth,adminOnly,(req,res)=>res.json(readDb().users.map(safeUser)));
app.post('/api/admin/accounts',auth,adminOnly,async(req,res)=>{
  const {nom,email,password}=req.body||{}; if(!nom||!email||!password) return res.status(400).json({error:'Champs requis'});
  const db=readDb(); if(db.users.some(u=>u.email.toLowerCase()===email.toLowerCase())) return res.status(409).json({error:'Cet e-mail est déjà utilisé.'});
  const u={id:crypto.randomUUID(),role:'superviseur',nom,email,passwordHash:await bcrypt.hash(password,12),active:true,createdAt:new Date().toISOString()}; db.users.push(u); writeDb(db); res.status(201).json(safeUser(u));
});
app.patch('/api/admin/accounts/:id/toggle',auth,adminOnly,(req,res)=>{const db=readDb();const u=db.users.find(x=>x.id===req.params.id);if(!u)return res.status(404).json({error:'Compte introuvable'});u.active=!u.active;writeDb(db);res.json(safeUser(u));});

app.get(/.*/,(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Vigil Bleu API: http://localhost:${PORT}`));
