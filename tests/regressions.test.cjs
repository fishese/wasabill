const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const app = html.match(/<script>([\s\S]*?)<\/script>/)[1].split('/* ── event wiring ── */')[0];

function harness(stored = {}, rpc = async () => ({ data: null, error: null }), library = true) {
  const storage = new Map(Object.entries(stored));
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, { value:'', checked:false, disabled:false, style:{},
      classList:{ add(){}, remove(){}, toggle(){} }, querySelectorAll(){return [];},
      setAttribute(){}, focus(){}, textContent:'', innerHTML:'' });
    return elements.get(id);
  };
  const client = { rpc, removeChannel() {}, channel() { throw Error('Unexpected channel'); } };
  const ctx = vm.createContext({ console:{error(){},log(){}}, structuredClone, TextEncoder, TextDecoder,
    URL, URLSearchParams, Uint8Array, Blob, setTimeout, clearTimeout,
    btoa:s => Buffer.from(s,'binary').toString('base64'), atob:s => Buffer.from(s,'base64').toString('binary'),
    window:{ supabase:library ? {createClient:()=>client} : undefined, addEventListener(){}, location:{} },
    navigator:{onLine:true}, document:{getElementById:el, querySelectorAll:()=>[]},
    localStorage:{ getItem:k=>storage.get(k) ?? null, setItem:(k,v)=>storage.set(k,v), removeItem:k=>storage.delete(k) },
    alert(){}, confirm:()=>true, crypto:require('node:crypto').webcrypto });
  vm.runInContext(app, ctx);
  vm.runInContext('renderSettings=()=>{}; renderTally=()=>{}; recalc=()=>{}; toast=()=>{}; showRoomBadge=()=>{}; hideLobby=()=>{};', ctx);
  return { ctx, el, storage, client, run:s=>vm.runInContext(s,ctx) };
}
const menu = (extra={}) => ({wasabillMenu:1,type:'full',name:'Test',standard:[{id:'red',price:12}],seasonal:[],...extra});
const snapshot = { bill:{id:'bill-a', room_code:'room-a'}, diners:[{id:'diner-a',name:'A'}], menu_items:[], events:[] };
function defer() { let resolve; const promise = new Promise(r=>resolve=r); return {promise,resolve}; }

test('entire inline application script parses, including event wiring', () => {
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (match[1].trim()) assert.doesNotThrow(() => new vm.Script(match[1]));
  }
});

test('duplicate join submissions and refresh retries add only one diner', async () => {
  const pending=defer(); let adds=0, refreshes=0;
  const h=harness({},async name=>{
    if (name==='add_diner') { adds++; return pending.promise; }
    if (++refreshes===1) return {data:null,error:Error('refresh failed')};
    return {data:snapshot,error:null};
  });
  h.ctx.snap=snapshot;
  h.run("joinPanelRoomData=snap; joinPanelCode='room-a'; enterRoom=()=>{}; claimDiner=()=>{}");
  const first=h.run('submitJoinPanel()'); await h.run('submitJoinPanel()');
  h.run('closeJoinPanel()');
  assert.equal(h.run('joinPanelCode'),'room-a');
  pending.resolve({data:'diner-a',error:null}); await first;
  assert.equal(h.run('joinPanelBusy'),false);
  await h.run('submitJoinPanel()');
  assert.equal(adds,1); assert.equal(refreshes,2);
  assert.equal(JSON.parse(h.storage.get('kaiten_room_v1')).diner_id,'diner-a');
});

test('existing diner joins refresh the snapshot before entering', async () => {
  let refreshed=false;
  const h=harness({},async name=>{assert.equal(name,'join_room');refreshed=true;return {data:snapshot,error:null};});
  h.ctx.snap=snapshot;
  h.run("joinPanelRoomData=snap; joinPanelCode='room-a'; enterRoom=()=>{}; claimDiner=()=>{}");
  await h.run("submitJoinPanel({existingDinerId:'diner-a'})");
  assert.equal(refreshed,true);
});

test('late join lookup cannot reopen the panel after choosing offline', async () => {
  const pending=defer(); const h=harness({},()=>pending.promise);
  h.el('lobbyCodeInput').value='room-a';
  const work=h.run('joinRoomByCode()'); h.run('useOffline()');
  pending.resolve({data:snapshot,error:null}); await work;
  assert.equal(h.run('joinPanelRoomData'),null);
  assert.equal(h.run('joinLookupBusy'),false);
  assert.equal(h.el('lobbyJoinBtn').disabled,false);
});

test('thrown join errors release the busy guard', async () => {
  const h=harness({},async()=>{throw Error('network');}); h.ctx.snap=snapshot;
  h.run("joinPanelRoomData=snap; joinPanelCode='room-a'");
  await h.run('submitJoinPanel()');
  assert.equal(h.run('joinPanelBusy'),false);
});

test('late claim acknowledgement cannot restore an abandoned room pointer', async () => {
  const pending=defer();
  const h=harness({kaiten_room_v1:JSON.stringify({bill_id:'bill-a'})},()=>pending.promise);
  h.run('isOnline=true'); const work=h.run("claimDiner('diner-a')");
  h.run('useOffline()'); pending.resolve({error:null}); await work;
  assert.equal(h.storage.has('kaiten_room_v1'),false);
});

test('removed room channel ignores late realtime and connection callbacks', () => {
  const h=harness({kaiten_room_v1:JSON.stringify({bill_id:'bill-a'})});
  const events=[]; let status;
  const channel={on(type,filter,fn){events.push(fn);return this;},subscribe(fn){status=fn;return this;}};
  h.client.channel=()=>channel;
  h.run("isOnline=true; subscribeToRoom('bill-a'); useOffline()");
  for (const fn of events) fn({new:{id:'late',status:'closed'},old:{id:'late'}});
  status('SUBSCRIBED');
  assert.equal(h.run('channelConnected'),false);
  assert.equal(h.run("tally.people.some(p=>p.id==='late')"),false);
});

test('offline app starts when the Supabase CDN is unavailable', () => {
  assert.doesNotThrow(()=>harness({}, undefined, false));
});
test('malformed settings and tally records recover without crashing', () => {
  const h=harness({kaiten_settings_v1:JSON.stringify({standard:{},seasonal:[]}), kaiten_tally_v1:JSON.stringify({people:[null]})});
  assert.equal(h.run('settings.standard.length'),6);
  assert.equal(h.run('tally.people[0].name'),'');
});
test('menu schema rejects inherited object keys as standard dish IDs', () => {
  const h=harness(); h.ctx.input=menu({standard:[{id:'constructor',price:1}]});
  assert.throws(()=>h.run('normalizeMenuV1(input)'));
});
test('saved libraries keep all records and repaired IDs are stable', () => {
  const records=Array.from({length:202},(_,i)=>({...menu(),id:'m'+i})); records[0].id='';
  const h=harness({kaiten_menus_v1:JSON.stringify(records)});
  assert.equal(h.run('loadSavedMenus().length'),202);
  assert.equal(h.run('loadSavedMenus()[0].id'),h.run('loadSavedMenus()[0].id'));
});
test('discount cents never go to an empty diner or exceed a subtotal', () => {
  const h=harness();
  h.run("settings.serviceCharge=false; settings.standard=[{id:'red',price:0.01}]; settings.discount={enabled:true,type:'pct',amount:50}; tally.people=[{name:'A',counts:{red:1}},{name:'B',counts:{red:1}},{name:'Empty',counts:{}}]");
  const result=h.run('computeBillBreakdown()');
  assert.equal(result.details[2].disc,0);
  assert.ok(result.details.every(d=>d.disc>=0 && d.disc<=d.sub && d.total>=0));
  assert.equal(result.details.reduce((s,d)=>s+d.disc,0),0.01);
});
test('restore response cannot re-enter a room after choosing offline', async () => {
  const pending=defer(), room={bill_id:'bill-a',room_code:'room-a',diner_id:'diner-a'};
  const h=harness({kaiten_room_v1:JSON.stringify(room)},()=>pending.promise);
  h.run('enterRoom=()=>{isOnline=true;}');
  const work=h.run('restoreSavedRoom()'); h.run('useOffline()');
  pending.resolve({data:snapshot,error:null}); await work;
  assert.equal(h.run('isOnline'),false);
});
test('resync response is ignored after leaving its room', async () => {
  const pending=defer(), room={bill_id:'bill-a',room_code:'room-a'};
  const h=harness({kaiten_room_v1:JSON.stringify(room)},()=>pending.promise);
  h.run('isOnline=true'); const work=h.run('resyncRoom()'); h.run('isOnline=false');
  pending.resolve({data:snapshot,error:null}); await work;
  assert.equal(h.run('isOnline'),false);
});
test('seasonal add handles realtime echo before RPC and preserves next draft', async () => {
  const pending=defer(); let params;
  const h=harness({kaiten_room_v1:JSON.stringify({bill_id:'bill-a'})},(name,p)=>{params=p;return pending.promise;});
  h.run('isOnline=true'); h.el('seasName').value='Uni'; h.el('seasPrice').value='12';
  const work=h.run('addSeasonal()');
  h.ctx.echo={id:'item-a',dish_key:params.p_dish_key,name:'Uni',price:12,kind:'seasonal',is_active:true};
  h.run('applyRemoteMenuItemUpsert(echo)');
  h.el('seasName').value='Next dish'; h.el('seasPrice').value='20';
  pending.resolve({data:'item-a',error:null}); await work;
  assert.equal(h.run('settings.seasonal.length'),1);
  assert.equal(h.el('seasName').value,'Next dish');
});
test('failed seasonal preset import leaves no unsaved local menu rows', async () => {
  const h=harness({kaiten_room_v1:JSON.stringify({bill_id:'bill-a'})},async()=>({data:null,error:Error('offline')}));
  h.ctx.input=menu({type:'seasonal',standard:[],seasonal:[{name:'Uni',price:12}]});
  h.run('isOnline=true'); await h.run('applySeasonalSet(input)'); await h.run('roomMenuSyncQueue');
  assert.equal(h.run('settings.seasonal.length'),0);
});
test('archiving a dish also removes its reverse event mapping', () => {
  const h=harness(); h.run("dishKeyByMenuItemId['item-a']='seas_a'");
  h.run("applyRemoteMenuItemUpsert({id:'item-a',dish_key:'seas_a',is_active:false})");
  assert.equal(h.run("dishKeyByMenuItemId['item-a']"),undefined);
});

test('saved specials layer onto full/default menus without changing presets', () => {
  const preset={...menu({type:'seasonal',standard:[],seasonal:[{name:'  UNI  Special ',price:30},{name:'Salmon',price:9}]}),id:'specials'};
  const h=harness({kaiten_menus_v1:JSON.stringify([preset])});
  h.run("createPanelSeasonal=[{name:'Uni Special',price:12},{name:'Other',price:5}]");
  const prices=h.run('JSON.stringify(createPanelStandard)');
  h.run("addSavedSpecialsToCreatePanel('specials'); addSavedSpecialsToCreatePanel('specials')");
  assert.equal(h.run('createPanelSeasonal.length'),3);
  assert.equal(h.run('createPanelSeasonal[0].price'),30);
  assert.equal(h.run('JSON.stringify(createPanelStandard)'),prices);
  assert.equal(h.run("loadSavedMenus()[0].seasonal[0].name"),'UNI  Special');
  h.run("createPanelSeasonal[0].price=99");
  assert.equal(h.run('loadSavedMenus()[0].seasonal[0].price'),30);
});
test('rapid seasonal applies wait for acknowledgements and reuse the added row', async () => {
  const calls=[];
  const h=harness({kaiten_room_v1:JSON.stringify({bill_id:'bill-a'})},async(name,p)=>{
    calls.push({name,p}); return {data:name==='add_menu_item'?'item-a':null,error:null};
  });
  h.ctx.input=menu({type:'seasonal',standard:[],seasonal:[{name:'Uni',price:12}]});
  h.run('isOnline=true'); const first=h.run('applySeasonalSet(input)');
  h.ctx.input2=menu({type:'seasonal',standard:[],seasonal:[{name:'Uni',price:20}]});
  const second=h.run('applySeasonalSet(input2)'); await Promise.all([first,second]);
  assert.deepEqual(calls.map(c=>c.name),['add_menu_item','update_menu_item']);
  assert.equal(h.run('settings.seasonal.length'),1);
  assert.equal(h.run('settings.seasonal[0].price'),20);
});
test('Unicode portable menus round-trip without runtime or bill fields', () => {
  const h=harness(); h.ctx.input={...menu({name:'寿司 🍣',seasonal:[{name:'海膽',price:22}]}),id:'local',tally:{secret:true}};
  const result=h.run('decodeSharedMenu(encodeSharedMenu(input))');
  assert.equal(result.name,'寿司 🍣'); assert.equal(result.id,undefined); assert.equal(result.tally,undefined);
});

function workerHarness() {
  const handlers={}, deleted=[]; const shell={ok:true, body:'cached app'};
  const cache={addAll:async()=>{},put:async()=>{}};
  const ctx=vm.createContext({URL,Response,fetch:async()=>{throw Error('offline');},
    caches:{open:async()=>cache, match:async url=>String(url).endsWith('/index.html')?shell:undefined,
      keys:async()=>['sushi-split-v17','unrelated-cache'],delete:async key=>deleted.push(key)},
    self:{registration:{scope:'https://example.test/app/'},addEventListener:(name,fn)=>handlers[name]=fn,
      clients:{claim(){}},skipWaiting(){}}});
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../sw.js'),'utf8'),ctx);
  return {handlers,deleted,shell};
}
test('offline navigation to root and room URLs falls back to app shell', async () => {
  const w=workerHarness();
  for (const path of ['/app/','/app/?room=red-tea','/app/index.html']) {
    let result; w.handlers.fetch({request:{method:'GET',mode:'navigate',url:'https://example.test'+path},respondWith:p=>result=p});
    assert.equal(await result,w.shell);
  }
});
test('service worker bypasses RPC writes and preserves unrelated caches', async () => {
  const w=workerHarness(); let intercepted=false;
  w.handlers.fetch({request:{method:'POST'},respondWith:()=>intercepted=true});
  assert.equal(intercepted,false);
  let work; w.handlers.activate({waitUntil:p=>work=p}); await work;
  assert.deepEqual(w.deleted,['sushi-split-v17']);
});
