'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','workspace-personal.js'),'utf8');
const start=source.indexOf('  function reorderFromDom(');
const end=source.indexOf('  function mountDashboard(){',start);
assert.ok(start>0&&end>start,'Pointer drag implementation should be available');
const runtime=source.slice(start,end);

class MiniNode {
  constructor(id,kind){
    this.id=id;
    this.kind=kind;
    this.dataset={widget:id,note:id};
    this.parentElement=null;
    this.children=[];
    this.hidden=false;
    this.style={setProperty(){}};
    const classes=new Set();
    this.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)};
  }
  matches(selector){
    return (selector==='.ws-widget'&&this.kind==='widget')||
      (selector==='.ws-note-card'&&this.kind==='note');
  }
  closest(selector){return this.matches(selector)?this:null;}
  getBoundingClientRect(){
    return {left:170,top:100,width:160,height:100,bottom:200,right:330};
  }
  get nextSibling(){
    if(!this.parentElement)return null;
    const siblings=this.parentElement.children;
    return siblings[siblings.indexOf(this)+1]||null;
  }
  get nextElementSibling(){return this.nextSibling;}
}
class MiniContainer {
  constructor(...nodes){this.children=[];this.append(...nodes);}
  append(...nodes){
    for(const node of nodes){
      if(node.parentElement){const i=node.parentElement.children.indexOf(node);if(i>=0)node.parentElement.children.splice(i,1);}
      this.children.push(node);node.parentElement=this;
    }
  }
  insertBefore(node,target){
    if(node.parentElement){const i=node.parentElement.children.indexOf(node);if(i>=0)node.parentElement.children.splice(i,1);}
    const idx=target?this.children.indexOf(target):-1;
    if(idx<0)this.children.push(node);
    else this.children.splice(idx,0,node);
    node.parentElement=this;
  }
  contains(node){return node===this||this.children.includes(node);}
}

function createHarness(kind){
  const a=new MiniNode(kind==='notes'?'note-a':'metrics',kind==='notes'?'note':'widget');
  const b=new MiniNode(kind==='notes'?'note-b':'presence',kind==='notes'?'note':'widget');
  const c=new MiniNode(kind==='notes'?'note-c':'quick',kind==='notes'?'note':'widget');
  const container=new MiniContainer(a,b,c);
  const registered={};
  let persisted=0,notePersisted=0;
  const docClasses=new Set();
  const body={classList:{add:x=>docClasses.add(x),remove:x=>docClasses.delete(x)},append(){}};
  const data={
    layout:{widgets:[a,b,c].map(x=>({id:x.id,color:'blue',hidden:false,size:'standard'})),nav:[]},
    notes:[a,b,c].map(x=>({id:x.id,title:x.id,color:'orange'}))
  };
  const context={
    data,WIDGETS:[['metrics','Case snapshot'],['presence','Active agents'],['quick','Quick access']],
    TABS:[],COLORS:{blue:'#2563eb',orange:'#c26718'},
    closePalettes(){},feedback(){},applyLayout(){},renderEditor(){},
    persistLayout(){persisted++;},drawNotes(){},persistNoteOrder(){notePersisted++;},
    dots(){return {};},
    make(tag,klass,title){
      return {
        tag,klass,title,style:{setProperty(){}},append(){},remove(){}
      };
    },
    document:{
      body,
      elementFromPoint(){return b;}
    },
    window:{
      innerHeight:900,
      addEventListener(name,handler){registered[name]=handler;},
      removeEventListener(name){delete registered[name];},
      scrollBy(){}
    },
    Math
  };
  const {beginPointerDrag}=vm.runInNewContext(runtime+'\n({beginPointerDrag})',context);
  const pointerDown={
    button:0,isPrimary:true,pointerId:1,clientX:20,clientY:110,preventDefault(){}
  };
  const fire=(name,x=260,y=150)=>{
    assert.equal(typeof registered[name],'function',name+' listener should be registered');
    registered[name]({pointerId:1,clientX:x,clientY:y,preventDefault(){}});
  };
  return {beginPointerDrag,pointerDown,fire,a,b,c,container,data,
    persisted:()=>persisted,notePersisted:()=>notePersisted,docClasses};
}
test('Nine-dot pointer drag reorders dashboard cards across the grid and saves once on drop',()=>{
  const t=createHarness('widgets');
  t.beginPointerDrag(t.pointerDown,{
    kind:'widgets',id:'metrics',source:t.a,container:t.container,selector:'.ws-widget'
  });
  t.fire('pointermove',275,150);
  assert.deepEqual(t.container.children.map(x=>x.id),['presence','metrics','quick']);
  assert.equal(t.persisted(),0,'Do not save intermediate pointer moves');
  t.fire('pointerup',275,150);
  assert.deepEqual(Array.from(t.data.layout.widgets,x=>x.id),['presence','metrics','quick']);
  assert.equal(t.persisted(),1,'Persist the new grid order after release');
  assert.equal(t.docClasses.has('ws-pointer-sorting'),false);
});
test('Dragging individual sticky notes changes their order and persists through note-specific endpoint',()=>{
  const t=createHarness('notes');
  t.beginPointerDrag(t.pointerDown,{
    kind:'notes',id:'note-a',source:t.a,container:t.container,selector:'.ws-note-card'
  });
  t.fire('pointermove',275,150);
  t.fire('pointerup',275,150);
  assert.deepEqual(Array.from(t.data.notes,x=>x.id),['note-b','note-a','note-c']);
  assert.equal(t.notePersisted(),1);
  assert.equal(t.persisted(),0);
});
test('Tapping a nine-dot handle without dragging does not overwrite saved layout',()=>{
  const t=createHarness('widgets');
  t.beginPointerDrag(t.pointerDown,{
    kind:'widgets',id:'metrics',source:t.a,container:t.container,selector:'.ws-widget'
  });
  t.fire('pointerup',20,110);
  assert.equal(t.persisted(),0);
  assert.deepEqual(t.container.children.map(x=>x.id),['metrics','presence','quick']);
});
