const {REPO, START, END}=require("../update-format");
const {crc32}=require("../update-zip");
const crypto=require("node:crypto"), {deflateRawSync}=require("node:zlib");
function pluginFiles(id = 'home-widgets', version = '0.2.0', minAppVersion = '1.5.0') {
  return {'main.js':Buffer.from(`module.exports = '${id}@${version}'`), 'manifest.json':Buffer.from(JSON.stringify({id, version, minAppVersion})), 'styles.css':Buffer.from(`/* ${version} */`)};
}
function archive(files, method = 8) {
  const local = [], central = []; let offset = 0;
  for (const [name, bytes] of Object.entries(files)) {
    const filename = Buffer.from(name), data = method === 8 ? deflateRawSync(bytes) : bytes;
    const header = Buffer.alloc(30), entry = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4); header.writeUInt16LE(method,8);
    header.writeUInt32LE(crc32(bytes),14); header.writeUInt32LE(data.length,18); header.writeUInt32LE(bytes.length,22); header.writeUInt16LE(filename.length,26);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20,4); entry.writeUInt16LE(20,6); entry.writeUInt16LE(method,10);
    entry.writeUInt32LE(crc32(bytes),16); entry.writeUInt32LE(data.length,20); entry.writeUInt32LE(bytes.length,24); entry.writeUInt16LE(filename.length,28); entry.writeUInt32LE(offset,42);
    local.push(header, filename, data); central.push(entry, filename); offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length,8); end.writeUInt16LE(Object.keys(files).length,10); end.writeUInt32LE(directory.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...local, directory, end]);
}
const digest = bytes => crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
function releaseFor(id = 'home-widgets', version = '0.2.0', minAppVersion = '1.5.0', zip = archive(pluginFiles(id,version,minAppVersion))) {
  return {tag_name:'plugins-0.2.0', draft:false, prerelease:false,
    body:`notes\n${START}\n\`\`\`json\n${JSON.stringify({formatVersion:1, plugins:[{id, version, minAppVersion, asset:id+'.zip'}]})}\n\`\`\`\n${END}`,
    assets:[{name:id+'.zip', state:'uploaded', size:zip.length, digest:'sha256:'+digest(zip), browser_download_url:`https://github.com/${REPO}/releases/download/plugins-0.2.0/${id}.zip`}]};
}
module.exports = {archive, pluginFiles, releaseFor, digest};
