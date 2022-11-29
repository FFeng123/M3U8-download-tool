dllist = []

function addm3u8(urlorfile,name){
    if(!name){
        if(typeof(urlorfile) == "object"){
            name = urlorfile.name;
        }else{
            name = urlorfile;
        }
    }
    dllist.push({
        "o": urlorfile,
        "name":name,
        "state": "wait",
        "tslist":[],
        "tsfile":{},
        "okn":0,// 当前有多少个ts已经完全完成了
        "okd":null,// 当前已经完全完成的数据
        "err":false,// 是否已经出现了错误
        "host":"",// 用于拼接m3u8中出现的目录
        "path":"",// 用于拼接m3u8中出现的目录
    });
}

async function download(downdata){
    if(downdata.state == "ok") return null;
    var maxthread = Math.floor(document.getElementById("inthread").value);
    var timeoutn = Math.floor(document.getElementById("intimeout").value);
    var threadn = 0;
    var sendn = downdata.okn;// 已经发出到第几个ts的请求了。
    var downed = sendn;
    downdata.err = false;

    function downloadts(url){
        // 文件相对路径处理
        var geturl = url;
        if(geturl.indexOf("://")){
            if(geturl[0] == "/"){
                geturl = downdata.host + geturl;
            }else{
                geturl = downdata.path + geturl;
            }
        }
        async function downloadloop(){
            while(true){
                var ac = new AbortController();
                var actid = setTimeout(() => {
                    ac.abort();
                }, timeoutn);
                let re;
                try{
                    re = await fetch(geturl,{
                        "mode":"cors",
                        "signal": ac.signal,
                    });
                    re = new Int8Array(await re.arrayBuffer());
                    downed += 1;
                    updataProg(downed / downdata.tslist.length);
                    
                    threadn -= 1;
                    clearTimeout(actid);
                    return re;
                }catch(err){
                    if(err.name != "AbortError"){
                        downdata.err = true;
                        break;
                    }
                    continue;
                }
            }
            
            threadn -= 1;
            clearTimeout(actid);
            return null;
        }
        downloadloop().then(re => {
            if(re){
                downdata.tsfile[url] = re;
            }
        })
        
    }
    function timeout(t){
        return new Promise((resolve, reject) =>{
            setTimeout(() => {
                resolve(null);
            }, t);
        })
    }
    // 解析m3u8文件
    if(downdata.o){
        let filel = (await(typeof downdata.o == "object" ? downdata.o : await fetch(downdata.o)).text()).replaceAll("\r","").split("\n");
        
        if(filel[0] == "#EXTM3U"){
            filel.forEach(e => {
                if(e[0] == "#" || e.length == 0){
                    return;
                }
                downdata.tslist.push(e);
            });
        }
        if(!downdata.tslist.length){
            throw downdata.state = "errm3u8";
        }
        // host和path获取
        if(typeof downdata.o == "string"){
            downdata.path = downdata.o.substr(0,downdata.o.lastIndexOf("/") + 1);
            downdata.host = downdata.path.substr(0,downdata.path.indexOf("/",10));
        }

        delete downdata.o;
    }
    // 并发线程下载
    while(sendn < downdata.tslist.length && (!downdata.err)){
        while(sendn < downdata.tslist.length && threadn < maxthread){
            if(!downdata.tsfile[downdata.tslist[sendn]]){
                downloadts(downdata.tslist[sendn]);
                threadn += 1;
            }else{
                downed += 1;
            }
            sendn += 1;
        }
        await timeout(200);
    }
    if(downdata.err){
        throw  downdata.state = "errnet";
    }
    // 等待所有下载完成
    while(threadn != 0){
        await timeout(200);
    }
    // 统计大小创建缓冲区
    let length = 4;
    for (const k in downdata.tsfile) {
        length += downdata.tsfile[k].length - 4;
    }
    downdata.okd = new Int8Array(length);
    // 复制数据
    length = 4;
    downdata.okd.set(new Int8Array([47,40,11,10]));
    downdata.tslist.forEach(e => {
        let d = downdata.tsfile[e].slice(4);
        delete downdata.tsfile[e];
        downdata.okd.set(d,length);
        length += d.length;
    });
    downdata.okn = length;
    downdata.state = "ok";
    return downdata.okd;
}

async function downloadAll(){
    updataProg(0,0);
    for (const i in dllist) {
        let e = dllist[i];
        if(e.state == "ok"){
            continue;
        }
        e.state = "run";
        updatadisplay();
        try{
            let data = await download(e);
            if(data){
                downloadFileData(data,e.name + ".ts");
            }
            e.okd = null;// 用后即焚，避免常驻内存。
        }catch(a){
            if(e.state == "run"){
                e.state = "errnet";
            }
            console.error(a);
        }
        updatadisplay();
        updataProg(1,Number(i) / dllist.length);
    }
}

//-----------------------------------------------//

var running = false;

function updatadisplay(){
    let lst = "";
    dllist.forEach(e =>{
        let statestr = "未知状态";
        switch (e.state) {
            case "wait":
                statestr = "等待下载"
                break;
            case "run":
                statestr = "正在下载"
                break;
            case "errm3u8":
                statestr = "格式错误"
                break;
            case "errnet":
                statestr = "网络错误"
                break;
            case "ok":
                statestr = "下载完成"
                break;
            default:
                break;
        }
        lst += `<div>${statestr} - ${e.name}</div>`
    });
    document.getElementById("filelist").innerHTML = lst;
}

var progall = document.getElementById("AllProg");
var progone = document.getElementById("OneProg");
var progallbuff = 0;

function updataProg(onen,alln = -1){
    if (alln == -1){
        alln = progallbuff;
    }
    progallbuff = alln;

    progone.value = onen;
    progall.value = alln + onen / dllist.length;
}

function onStartBtn(){
    if(running || (!dllist.length)) return;
    running = true;
    downloadAll().finally(re => {
        running = false;
    })
}

function clean(){
    if(running) return;
    let dels = [];
    for (const i in dllist) {
        if(dllist[i].state == "ok" || dllist[i].state == "errm3u8"){
            dels.push(Number(i));
        }
    }
    dels.reverse();
    dels.forEach(e=>{
        dllist.splice(e,e + 1);
    });
    updatadisplay();
}

function onAddURLBtn(){
    if(running) return;

    addm3u8(document.getElementById("inputurl").value);
    
    updatadisplay();
}

function onSelectFile(){
    if(running) return;

    Array.from(document.getElementById("inputFile").files).forEach(e =>{
        addm3u8(e);
    });
    
    updatadisplay();
}

function downloadFileData(data, fileName) {
    blob = new Blob([data],{"type": 'application/octet-stream'});
    let blobUrl = window.URL.createObjectURL(blob);
    let link = document.createElement('a');
    link.download = fileName;
    link.style.display = 'none';
    link.href = blobUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}