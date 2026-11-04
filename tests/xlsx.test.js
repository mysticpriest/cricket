'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const zlib=require('node:zlib');
const {workbookXlsx}=require('../server/xlsx');

function unzipEntries(data){
  const files=new Map();
  let offset=0;
  while(offset+30<=data.length && data.readUInt32LE(offset)===0x04034b50){
    const method=data.readUInt16LE(offset+8);
    const compressed=data.readUInt32LE(offset+18);
    const filenameLength=data.readUInt16LE(offset+26);
    const extraLength=data.readUInt16LE(offset+28);
    const name=data.subarray(offset+30,offset+30+filenameLength).toString('utf8');
    const start=offset+30+filenameLength+extraLength;
    const bytes=data.subarray(start,start+compressed);
    files.set(name,(method===8?zlib.inflateRawSync(bytes):bytes).toString('utf8'));
    offset=start+compressed;
  }
  return files;
}

test('XLSX export is a valid offline OOXML archive with literal user strings',()=>{
  const xlsx=workbookXlsx([{name:'Case details',rows:[
    ['Case ID','Call note','Score'],
    ['CR-20261031-000001','=HYPERLINK("https://evil.example") & special <text>',75],
    ['CR-20261031-000002','A multiline\ncall summary',100]
  ]},{name:'Reviews',rows:[['Decision'],['Approved']]}]);
  assert.equal(xlsx.readUInt32LE(0),0x04034b50);
  assert.equal(xlsx.readUInt32LE(xlsx.length-22),0x06054b50);
  const files=unzipEntries(xlsx);
  for(const path of ['[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/_rels/workbook.xml.rels','xl/styles.xml','xl/worksheets/sheet1.xml','xl/worksheets/sheet2.xml']){
    assert.ok(files.has(path),path+' missing');
  }
  const sheet=files.get('xl/worksheets/sheet1.xml');
  assert.match(sheet,/t="inlineStr"/);
  assert.match(sheet,/=HYPERLINK/);
  assert.match(sheet,/&amp; special &lt;text&gt;/);
  assert.match(sheet,/<v>75<\/v>/);
  assert.match(sheet,/autoFilter/);
  assert.match(files.get('xl/workbook.xml'),/Case details/);
});