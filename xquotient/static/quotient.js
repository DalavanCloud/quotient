function resizeIFrame(frame) {
  // Code is from http://www.ozoneasylum.com/9671&latestPost=true
  try {
    // Get the document within the frame. This is where you will fail with 'permission denied'
    // if the document within the frame is not from the same domain as this document.
    // Note: IE uses 'contentWindow', Opera uses 'contentDocument', Netscape uses either.
    innerDoc = (frame.contentDocument) ? frame.contentDocument : frame.contentWindow.document;


    // Resize the style object, if it exists. Otherwise, resize the frame itself.
    objToResize = (frame.style) ? frame.style : frame;


    // Resize the object to the scroll height of the inner document body. You may still have 
    // to add a 'fudge' factor to get rid of the scroll bar entirely. With a plain-vanilla 
    // iframe, I found Netscape needs no fudge, IE needs 4 and Opera needs 5... 
    // Of course, your mileage may vary.
    objToResize.height = innerDoc.body.scrollHeight + 20 + 'px';
    objToResize.width = innerDoc.body.scrollWidth + 5 + 'px';
  }
  catch (e) {
    window.status = e.message;
  }
}


function resizeIFrameHeight(frame) {
  try {
    innerDoc = (frame.contentDocument) ? frame.contentDocument : frame.contentWindow.document;
    objToResize = (frame.style) ? frame.style : frame;
    objToResize.height = innerDoc.body.scrollHeight + 20 + 'px';
  }
  catch (e) {
    window.status = e.message;
  }
}

function findPosY(obj) {
    var curtop = 0;
    if (obj.offsetParent)
    {
        while (obj.offsetParent)
        {
            curtop += obj.offsetTop
            obj = obj.offsetParent;
        }
    }
    else if (obj.y)
        curtop += obj.y;
    return curtop;
}

function findPosX(obj) {
    var curleft = 0;
    if (obj.offsetParent)
    {
        while (obj.offsetParent)
        {
            curleft += obj.offsetLeft
            obj = obj.offsetParent;
        }
    }
    else if (obj.x)
        curleft += obj.x;
    return curleft;
}

function fitMessageDetailToPage() {
    var element = document.getElementById("message-detail");
    element.style.height = innerWindowHeight() - findPosY(element) - 20 + 'px';
}

function centerAndDisplayDialog(dialog) {
    var middleX = innerWindowWidth() / 2;
    var middleY = innerWindowHeight() / 2;

    dialog.style.display = "";
    dialog.style.visibility = "hidden";
    dialog.style.left = middleX - (dialog.clientWidth / 2);
    dialog.style.top  = middleY - (dialog.clientHeight / 2);
    dialog.style.visibility = "visible";
}

function purgeChildren(e) {
    while(0 < e.childNodes.length)
        e.removeChild(e.firstChild);
}

function addTags() {
    var tagdialog = document.getElementById("add-tags-dialog");
    purgeChildren(document.getElementById("add-tags-dialog-tag-list"));
    centerAndDisplayDialog(tagdialog);
    document.getElementById("add-tags-dialog-text-input").focus();
}

function innerWindowHeight() {
    return document.getElementsByTagName("body")[0].clientHeight;
}

function innerWindowWidth() {
    return document.getElementsByTagName("body")[0].clientWidth;
}

function addTag(form) {
    var mtags = document.getElementById("message-tags");
    purgeChildren(mtags);
    mtags.appendChild(document.createTextNode("Loading..."));

    var tag = form.tag.value;
    var tags = null;
    if(tag.match(/,/))
        tags = tag.split(/,/);
    else
        tags = [tag];

    var taglist = document.getElementById("add-tags-dialog-tag-list");

    for(var i = 0; i < tags.length; i++) {
        tag = tags[i].replace(/^\s+/, "").replace(/\s+$/, "").replace(/\s{2,}/, " ");
        var li = document.createElement("li");
        li.appendChild(document.createTextNode(tag));
        taglist.appendChild(li);
        server.handle('addTag', tag);
    }
    form.tag.value = ""; form.tag.focus();
}

function closeAddTagsDialog() {
    var dlg = document.getElementById("add-tags-dialog");
    with(dlg.style) {
        display = "none";
        left = top = 0;
    }
}

function loadMessage(messageID) {
    fitMessageDetailToPage();
    server.handle('loadMessage', messageID);
}

function nextMessage() { server.handle('nextMessage') }
function nextUnreadMessage() { server.handle('nextUnreadMessage') }
function prevMessage() { server.handle('prevMessage') }
