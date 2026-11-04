'use strict';
// Small standards-compliant XLSX writer built from Node's standard library.
// No external dependency or browser CDN is required for the offline demo.
const zlib = require('node:zlib');

const TABLE = Array.from({length:256},(_,index)=>{
  let c=index;
  for(let j=0;j<8;j++) c=c&1 ? 0xedb88320^(c>>>1) : c>>>1;
  return c>>>0;
});
function crc32(data){
  let value=0xffffffff;
  for(const byte of data) value=TABLE[(value^byte)&255]^(value>>>8);
  return (value^0xffffffff)>>>0;
}
function esc(value){
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function column(index){
  let n=index+1, s='';
  while(n){n--;s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26);}
  return s;
}
function xlsxSheet(rows){
  const width=rows.reduce((m,row)=>Math.max(m,row.length),0);
  const widths=Array.from({length:width},(_,i)=>{
    let n=12;
    for(const row of rows.slice(0,80)) n=Math.max(n,Math.min(44,String(row[i]??'').split('\n')[0].length+3));
    return '<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+n+'" customWidth="1"/>';
  }).join('');
  let xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<cols>'+widths+'</cols><sheetData>';
  rows.forEach((row,i)=>{
    xml+='<row r="'+(i+1)+'">';
    row.forEach((value,j)=>{
      const cell=column(j)+(i+1);
      const style=i===0?' s="1"':(i%2===0?' s="2"':'');
      if(typeof value==='number' && Number.isFinite(value)){
        xml+='<c r="'+cell+'"'+style+'><v>'+value+'</v></c>';
      }else{
        // All user text is serialized as literal inline string: no formula evaluation.
        xml+='<c r="'+cell+'" t="inlineStr"'+style+'><is><t xml:space="preserve">'+esc(value)+'</t></is></c>';
      }
    });
    xml+='</row>';
  });
  xml+='</sheetData>';
  if(rows.length>1 && width>0) xml+='<autoFilter ref="A1:'+column(width-1)+rows.length+'"/>';
  return xml+'</worksheet>';
}
function zip(entries){
  const locals=[],centers=[];let offset=0;
  for(const [name,content] of entries){
    const filename=Buffer.from(name,'utf8');
    const bytes=Buffer.from(content,'utf8');
    const compressed=zlib.deflateRawSync(bytes,{level:6});
    const crc=crc32(bytes);
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);
    local.writeUInt16LE(0,6);local.writeUInt16LE(8,8);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);
    local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(filename.length,26);
    locals.push(local,filename,compressed);
    const center=Buffer.alloc(46);
    center.writeUInt32LE(0x02014b50,0);center.writeUInt16LE(20,4);
    center.writeUInt16LE(20,6);center.writeUInt16LE(8,10);
    center.writeUInt32LE(crc,16);center.writeUInt32LE(compressed.length,20);
    center.writeUInt32LE(bytes.length,24);center.writeUInt16LE(filename.length,28);
    center.writeUInt32LE(offset,42);centers.push(center,filename);
    offset+=local.length+filename.length+compressed.length;
  }
  const central=Buffer.concat(centers);
  const end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);
  end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,central,end]);
}
function workbookXlsx(sheets){
  if(!Array.isArray(sheets) || sheets.length<1 || sheets.length>15) throw Error('Invalid XLSX sheets');
  const common='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const names=sheets.map((sheet,i)=>String(sheet.name||('Sheet '+(i+1))).replace(/[\\/*?:\[\]]/g,'').slice(0,31));
  const content='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets.map((_,i)=>'<Override PartName="/xl/worksheets/sheet'+(i+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
    '</Types>';
  const workbook='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="'+common+'">' +
    '<sheets>'+names.map((name,i)=>'<sheet name="'+esc(name)+'" sheetId="'+(i+1)+'" r:id="rId'+(i+1)+'"/>').join('')+'</sheets></workbook>';
  const rels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_,i)=>'<Relationship Id="rId'+(i+1)+'" Type="'+common+'/worksheet" Target="worksheets/sheet'+(i+1)+'.xml"/>').join('') +
    '<Relationship Id="rId'+(sheets.length+1)+'" Type="'+common+'/styles" Target="styles.xml"/></Relationships>';
  const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/></cellXfs>' +
    '</styleSheet>';
  const baseRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="'+common+'/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const entries=[
    ['[Content_Types].xml',content],['_rels/.rels',baseRels],
    ['xl/workbook.xml',workbook],['xl/_rels/workbook.xml.rels',rels],['xl/styles.xml',styles]
  ];
  sheets.forEach((sheet,i)=>entries.push(['xl/worksheets/sheet'+(i+1)+'.xml',xlsxSheet(sheet.rows)]));
  return zip(entries);
}
module.exports={workbookXlsx};
