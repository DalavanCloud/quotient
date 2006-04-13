// import Quotient
// import Mantissa.ScrollTable

Quotient.Extracts = {};

Quotient.Extracts.ScrollingWidget = Mantissa.ScrollTable.ScrollingWidget.subclass(
                                        'Quotient.Extracts.ScrollingWidget');

Quotient.Extracts.ScrollingWidget.methods(
    function __init__(self, node) {
        Quotient.Extracts.ScrollingWidget.upcall(self, "__init__", node);
        self._scrollViewport.style.maxHeight = '200px';
    },
    
    function setViewportHeight(self, rowCount) {
        var r = MochiKit.DOM.DIV({"style": "visibility: hidden",
                                  "class": "scroll-row"},
                    [MochiKit.DOM.DIV({"class": "scroll-cell",
                                       "style": "float: none"}, "TEST!!!"),
                     MochiKit.DOM.DIV({"class": "scroll-cell",
                                       "style": "float: none"}, "TEST!!!")]);

        self._scrollContent.appendChild(r);
        var rowHeight = r.clientHeight
        self._scrollContent.removeChild(r);

        self._rowHeight = rowHeight;
        var scrollContentHeight = rowHeight * rowCount;
        self._scrollContent.style.height = scrollContentHeight + 'px';
    },
    
    function makeRowElement(self, rowOffset, rowData, cells) {
        var ecol = self.makeCellElement("excerpt", rowData);
        ecol.style.width = "500px";
        ecol.className = "excerpt-column";

        return MochiKit.DOM.A(
            {"class": "scroll-row",
             "style": "height:" + self._rowHeight + "px",
             "href": rowData['__id__']},
            cells.concat([ecol]));
    },

    function skipColumn(self, name) {
        return name == "excerpt";
    });