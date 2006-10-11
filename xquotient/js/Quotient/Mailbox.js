
/**
 *
 * XXX TODO -
 *
 * - Synchronized getter/setter methods: current _selectWebID returns a
 *   Deferred: if you call getSelectedRow before that Deferred fires, you'll
 *   get the newly selected row; if you try to inspect the message detail
 *   (display or structured data) before that Deferred fires, you'll see the
 *   old message data.
 *
 * - Batched updates: calling _selectWebID multiple times before the first
 *   call's Deferred fires should make the fewest round-trips and display
 *   updates possible, rather than doing all of the intermediate work which has
 *   been rendered irrelevant by the subsequent calls.
 *
 */


// import Mantissa.People
// import Mantissa.ScrollTable
// import Mantissa.LiveForm

// import Quotient
// import Quotient.Common
// import Quotient.Throbber
// import Quotient.Message


Quotient.Mailbox.ScrollingWidget = Mantissa.ScrollTable.ScrollingWidget.subclass(
    "Quotient.Mailbox.ScrollingWidget");

Quotient.Mailbox.ScrollingWidget.methods(
    function __init__(self, node) {
        /*
         * XXX TODO - viewSelection should be a parameter to __init__
         */
        self.viewSelection = {
            "view": "inbox",
            "tag": null,
            "person": null,
            "account": null};
        self.selectedGroup = {};
        self.columnAliases = {"receivedWhen": "Date", "senderDisplay": "Sender"};

        Quotient.Mailbox.ScrollingWidget.upcall(self, "__init__", node);

        self._scrollViewport.style.maxHeight = "";
        self.ypos = Quotient.Common.Util.findPosY(self._scrollViewport.parentNode);
        try {
            self.throbberNode = Nevow.Athena.FirstNodeByAttribute(self.node.parentNode, "class", "throbber");
        } catch (err) {
            self.throbberNode = document.createElement('span');
        }
        self.throbber = Quotient.Throbber.Throbber(self.throbberNode);
    },

    /**
     * Override the base implementation to pass along our current view
     * selection.
     */
    function getTableMetadata(self) {
        return self.callRemote("getTableMetadata", self.viewSelection);
    },

    /**
     * Override the base implementation to pass along our current view
     * selection.
     */
    function getRows(self, firstRow, lastRow) {
        return self.callRemote("requestRowRange", self.viewSelection, firstRow, lastRow);
    },

    /**
     * Override default row to add some divs with particular classes, since
     * they will most likely change the height of our rows.
     */
    function _getRowGuineaPig(self) {
        return MochiKit.DOM.DIV(
            {"style": "visibility: hidden; font-weight: bold",
             "class": "q-scroll-row"},
            [MochiKit.DOM.DIV({"class": "sender"}, "TEST!!!"),
             MochiKit.DOM.DIV({"class": "subject"}, "TEST!!!"),
             MochiKit.DOM.DIV(null, "TEST!!!")]);
    },


    /**
     * Change the view being viewed.  Return a Deferred which fires with the
     * number of messages in the new view.
     */
    function changeViewSelection(self, viewType, value) {
        self.throbber.startThrobbing();
        self.viewSelection[viewType] = value;
        var result = Divmod.Defer.gatherResults(
            [self.callRemote("requestCurrentSize", self.viewSelection),
             self.emptyAndRefill()]);
        result.addCallback(
            function(info) {
                var messageCount = info[0];
                self.setViewportHeight(messageCount);
                return self._selectFirstRow().addCallback(
                    function(ignored) {
                        return messageCount;
                    });
            });
        result.addBoth(
            function(passthrough) {
                self.throbber.stopThrobbing();
                return passthrough;
            });
        return result;
    },

    /**
     * Extend the base behavior to reset the message selection group tracking
     * object.
     *
     * XXX - The base scrolltable should really support selection, so all of
     * the selection related features like this one should move over there.
     */
    function emptyAndRefill(self) {
        self.selectedGroup = {};
        return self._selectWebID(null).addCallback(
            function(ignored) {
                return Quotient.Mailbox.ScrollingWidget.upcall(self, 'emptyAndRefill');
            });
    },

    /**
     * Override this to do nothing because the Inbox cannot be sorted at all!
     *
     * XXX - Hey, wtf, why can't the inbox be sorted? -exarkun
     */
    function setSortInfo(self, currentSortColumn, isAscendingNow) {},

    /**
     * Override this to return an empty Array because the Inbox has no row
     * headers.
     */
    function _createRowHeaders(self, columnNames) {
        return [];
    },

    /*****************************************************\
    |**         ISelectableScrollingWidget              **|
    \*****************************************************/

    /**
     * Change the current message selection to the given webID.
     *
     * If a message was already selected, change its background color back to
     * the unselected color.  Change the newly selected message's background
     * color to the selected color.
     *
     * If C{webID} is C{null}, only unselect the currently selected message.
     *
     * @type webID: string
     *
     * @return: A Deferred which will fire with the webID of the previously
     * selected message, or null if there was no previously selected message,
     * once the selection has been changed and the mailbox view brought up to
     * date.
     */
    function _selectWebID(self, webID) {
        var row;
        var node, oldNode = null;
        var oldSelectedRowID = null;

        if (self._selectedRowID) {
            oldSelectedRowID = self._selectedRowID;
            oldNode = self.model.findRowData(self._selectedRowID).__node__;
            oldNode.style.backgroundColor = '';
        }

        if (webID != null) {
            self._selectedRowID = webID;

            row = self.model.findRowData(webID);
            node = row.__node__;

            row["read"] = true;

            if (node.style.fontWeight == "bold") {
                self.decrementActiveMailViewCount();
            }

            node.style.fontWeight = "";
            node.style.backgroundColor = '#FFFFFF';
        } else {
            self._selectedRowID = null;
        }

        return self.selectionChanged(webID).addCallback(
            function(ignored) {
                return oldSelectedRowID;
            });
    },

    /**
     * Called whenever the selected row is changed.
     */
    function selectionChanged(self, webID) {
        return self.widgetParent.selectionChanged(webID);
    },

    function decrementActiveMailViewCount(self) {
        return self.widgetParent.decrementActiveMailViewCount();
    },

    /**
     * Remove the row at the given index and update the message selection if
     * necessary.
     */
    function removeRow(self, index) {
        var unselect;
        var row = self.model.getRowData(index);
        /*
         * The row was selected - unselect it quick or
         * something terrible will occur.
         */
        if (row.__id__ == self._selectedRowID) {
            unselect = self._selectWebID(null);
        } else {
            unselect = Divmod.Defer.succeed(null);
        }
        return unselect.addCallback(
            function(ignored) {
                Quotient.Mailbox.ScrollingWidget.upcall(self, 'removeRow', index);
            });
    },

    /**
     * Return the row data for the currently selected row.  Return null if
     * there is no row selected.
     */
    function getSelectedRow(self) {
        if (self._selectedRowID != null) {
            return self.model.findRowData(self._selectedRowID);
        }
        return null;
    },

    /**
     * Call _selectWebID with the webID of the first row of data currently
     * available.
     *
     * If there are no rows, no action will be taken.
     */
    function _selectFirstRow(self) {
        var webID;
        if (self.model.rowCount()) {
            webID = self.model.getRowData(0)['__id__'];
        } else {
            webID = null;
        }
        return self._selectWebID(webID);
    },


    /**
     * Override row creation to provide a different style.
     *
     * XXX - should be template changes.
     */
    function makeRowElement(self, rowOffset, rowData, cells) {
        var style = "border-top: solid 1px #FFFFFF; height: " + (self._rowHeight - 9) + "px";
        if(!rowData["read"]) {
            style += ";font-weight: bold";
        }
        var data = [MochiKit.Base.filter(null, cells)];
        if(0 < rowData["attachments"]) {
            data.push(MochiKit.DOM.IMG({"src": "/Quotient/static/images/paperclip.png",
                                        "style": "float: right; border: none"}));
        }
        return MochiKit.DOM.A(
            {"class": "q-scroll-row",
             "href": "#",
             "style": style,
             "onclick": function(event) {
                    var webID = rowData["__id__"];
                    return Nevow.Athena.Widget.dispatchEvent(
                        self, "onclick", "<row clicked>",
                        function() {
                            /* don't select based on rowOffset because it'll
                             * change as rows are removed
                             */
                            self._selectWebID(webID);
                            return false;
                        });
                }
            }, data);
    },

    /**
     * Extend base behavior to recognize the subject column and replace empty
     * subjects with a special string.
     *
     * XXX - Dynamic dispatch for column names or templates or something.
     */
    function massageColumnValue(self, name, type, value) {
        var res = Quotient.Mailbox.ScrollingWidget.upcall(
                        self, "massageColumnValue", name, type, value);

        var ALL_WHITESPACE = /^\s*$/;
        if(name == "subject" && ALL_WHITESPACE.test(res)) {
            res = "<no subject>";
        }
        return res;
    },

    /**
     * Override the base behavior to add a million and one special cases for
     * things like the "ever deferred" boomerang or to change the name of the
     * "receivedWhen" column to something totally unrelated like "sentWhen".
     *
     * XXX - Should just be template crap.
     */
    function makeCellElement(self, colName, rowData) {
        if(colName == "receivedWhen") {
            colName = "sentWhen";
        }
        var massage = function(colName) {
            return self.massageColumnValue(
                colName, self.columnTypes[colName][0], rowData[colName]);
        }

        var attrs = {};
        if(colName == "senderDisplay") {
            attrs["class"] = "sender";
            attrs["title"] = rowData["sender"];
            var content = [
                MochiKit.DOM.IMG({
                    "src": "/Quotient/static/images/checkbox-off.gif",
                    "class": "checkbox-image",
                    "border": 0,
                    "onclick": function senderDisplayClicked(event) {
                        self.groupSelectRowAndUpdateCheckbox(rowData["__id__"], this);

                        this.blur();

                        if (!event) {
                            event = window.event;
                        }
                        event.cancelBubble = true;
                        if(event.stopPropagation) {
                            event.stopPropagation();
                        }

                        return false;
                    }}), massage(colName)];

            if (rowData["everDeferred"]) {
                content.push(IMG({"src": "/Quotient/static/images/boomerang.gif",
                                  "border": "0"}));
            }

            return MochiKit.DOM.DIV(attrs, content);
        } else if(colName == "subject") {
            attrs["class"] = "subject";
        } else {
            attrs["class"] = "date";
        }

        return MochiKit.DOM.DIV(attrs, massage(colName));
    },

    /**
     * Toggle the membership of a row in the group selection set.
     */
    function groupSelectRow(self, webID) {
        var state;
        if(webID in self.selectedGroup) {
            delete self.selectedGroup[webID];
            state = "off";
        } else {
            self.selectedGroup[webID] = true;
            state = "on";
        }

        var selcount = MochiKit.Base.keys(self.selectedGroup).length;
        /* are we transitioning from 0->1 or 1->0? */
        if (selcount == 0 && state == "off") {
            self.disableGroupActions();
        } else if (selcount == 1 && state == "on") {
            self.enableGroupActions();
        }
        return state;
    },

    /**
     * Enable the user-interface for performing actions on the selected group
     * of messages.
     *
     * XXX Give the widget parent a real enable method.
     */
    function enableGroupActions(self) {
        self.widgetParent.toggleGroupActions();
    },

    /**
     * Disable the user-interface for performing actions on the selected group
     * of messages.
     *
     * XXX Give the widget parent a real disable method.
     */
    function disableGroupActions(self) {
        self.widgetParent.toggleGroupActions();
    },

    /**
     * Toggle the membership of a row in the group selection set and update the
     * checkbox image for that row.
     */
    function groupSelectRowAndUpdateCheckbox(self, webID, checkboxImage) {
        var state = self.groupSelectRow(webID);
        var segs = checkboxImage.src.split("/");
        segs[segs.length - 1] = "checkbox-" + state + ".gif";
        checkboxImage.src = segs.join("/");
    },

    /**
     * Return the checkbox image node for the given row.
     */
    function _getCheckbox(self, row) {
        return Divmod.Runtime.theRuntime.firstNodeByAttribute(
            row.__node__, 'class', 'checkbox-image');
    },

    /**
     * Add, or remove all *already requested* rows to the group selection
     * @param selectRows: if true, select matching rows, otherwise deselect
     * @param predicate: function that accepts a mapping of column names to
     *                   column values & returns a boolean indicating whether
     *                   the row should be included in the selection
     * @return: the number of matching rows
     */
    function massSelectOrNot(self,
                             selectRows/*=true*/,
                             predicate/*=null*/) {

        if(selectRows == undefined) {
            selectRows = true;
        }
        if(predicate == undefined) {
            predicate = function(r) {
                return true
            }
        }

        var selected, row, webID, count=0;
        for(var i = 0; i < self.model.rowCount(); i++) {
            row = self.model.getRowData(i);
            if(row) {
                webID = row.__id__;
                selected = (webID in self.selectedGroup);
                /* if we like this row */
                if(predicate(row)) {
                    /* and it's selection status isn't the desired one */
                    if(selected != selectRows) {
                        /* then change it */
                        self.groupSelectRowAndUpdateCheckbox(webID, self._getCheckbox(row));
                        count++;
                    }
                /* if we don't like it, but it's in the target state */
                } else if(selected == selectRows) {
                    /* then change it */
                    self.groupSelectRowAndUpdateCheckbox(webID, self._getCheckbox(row));
                }
            }
        }
        return count;
    },

    /**
     * Override the base implementation to optionally use the specified second
     * Date instance as a point of reference.
     *
     * XXX - Why isn't this just the base implementation?
     */
    function formatDate(self, when, /* optional */ now) {
        if (now == undefined) {
            now = new Date();
        }
        function to12Hour(HH, MM) {
            var meridian;
            if(HH == 0) {
                HH += 12;
                meridian = "AM";
            } else if(0 < HH && HH < 12) {
                meridian = "AM";
            } else if(HH == 12) {
                meridian = "PM";
            } else {
                HH -= 12;
                meridian = "PM";
            }
            return HH + ":" + pad(MM) + " " + meridian;
        }
        function pad(n) {
            return (n < 10) ? "0" + n : n;
        }
        function explode(d) {
            return [d.getFullYear(), d.getMonth(), d.getDate()];
        }
        function arraysEqual(a, b) {
            if (a.length != b.length) {
                return false;
            }
            for (var i = 0; i < a.length; ++i) {
                if (a[i] != b[i]) {
                    return false;
                }
            }
            return true;
        }
        var parts = explode(when);
        var todayParts = explode(now);
        if (arraysEqual(parts, todayParts)) {
            /* it's today! Format it like "12:15 PM"
             */
            return to12Hour(when.getHours(), when.getMinutes());
        }
        if (parts[0] == todayParts[0]) {
            /* it's this year - format it like "Jan 12"
             *
             * XXX - Localization or whatever.
             */
            var monthNames = [
                "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            return monthNames[parts[1]] + " " + parts[2];
        }
        return [pad(when.getFullYear()),
                pad(when.getMonth() + 1),
                pad(when.getDate())].join("-");
    },

    /**
     * Override to hide any of the columns from which we're extracting row
     * metadata.
     */
    function skipColumn(self, name) {
        return name == "read" || name == "sentWhen" ||
               name == "attachments" || name == "everDeferred" ||
               name == "sender";
    },

    /**
     * Override to update counts and do something else.
     *
     * XXX - This should be a callback on .scrolled()
     * XXX - And counts should be managed in some completely different way
     */
    function cbRowsFetched(self, count) {
        self.widgetParent.rowsFetched(count);
    });


/**
 * Run interference for a ScrollTable.
 *
 * @ivar contentTableGrid: An Array of the the major components of an inbox
 * view.  The first element is an array with three elements: the td element for
 * the view selection area, the td element for the scrolltable, and the td
 * element for the message detail area.  The second element is also an array
 * with three elements: the footer td elements which correspond to the three td
 * elements in the first array.
 */
Quotient.Mailbox.Controller = Nevow.Athena.Widget.subclass('Quotient.Mailbox.Controller');
Quotient.Mailbox.Controller.methods(
    function __init__(self, node, complexityLevel) {
        Quotient.Mailbox.Controller.upcall(self, '__init__', node);
        self.complexityLevel = complexityLevel;

        /*
         * Fired when the initial load has finished.
         */
        self.initializationDeferred = Divmod.Defer.Deferred();
    },

    /**
     * Do a bunch of initialization, like finding useful nodes and child
     * widgets and filling up the scrolltable.
     */
    function loaded(self) {
        self.lastPageSize = Divmod.Runtime.theRuntime.getPageSize();

        /*
         * Hide the footer for some reason I can't guess.
         */
        var footer = document.getElementById("mantissa-footer");
        if (footer) {
            footer.style.display = "none";
        }

        MochiKit.DOM.addToCallStack(window, "onload",
            function() {
                MochiKit.DOM.addToCallStack(window, "onresize",
                    function() {
                        var pageSize = Divmod.Runtime.theRuntime.getPageSize();
                        if(pageSize.w != self.lastPageSize.w || pageSize.h != self.lastPageSize.h) {
                            self.lastPageSize = pageSize;
                            self.resized(false);
                        }
                    }, false);
            }, false);

        var search = document.getElementById("search-button");
        if(search) {
            /* if there aren't any search providers available,
             * then there won't be a search button */
            var width = Divmod.Runtime.theRuntime.getElementSize(search.parentNode).w;
            var contentTableContainer = self.firstNodeByAttribute("class", "content-table-container");
            contentTableContainer.style.paddingRight = width + "px";
        }

        self._batchSelectionPredicates = {read:   function(r) { return  r["read"] },
                                          unread: function(r) { return !r["read"] }}

        self.currentMessageData = null;

        var contentTableNodes = self._getContentTableGrid();
        self.contentTable = contentTableNodes.table;
        self.contentTableGrid = contentTableNodes.grid;

        self.setupMailViewNodes();

        self.messageDetail = self.firstWithClass(self.contentTableGrid[0][2], "message-detail");


        self.progressBar = self.firstWithClass(
            self.contentTableGrid[1][2], "progress-bar");

        self.messageActions = self.firstNodeByAttribute("class", "message-actions");

        self.deferForm = self.nodeByAttribute("class", "defer-form");
        self.deferSelect = self.nodeByAttribute("class", "defer");

        self.ypos = Quotient.Common.Util.findPosY(self.messageDetail);
        self.messageBlockYPos = Quotient.Common.Util.findPosY(self.messageDetail.parentNode);

        self.viewPaneCell = self.firstWithClass(self.contentTableGrid[0][0], "view-pane-cell");
        self.viewShortcutSelect = self.firstWithClass(self.node, "view-shortcut-container");

        var scrollNode = self.firstNodeByAttribute("athena:class", "Quotient.Mailbox.ScrollingWidget");

        self.scrollWidget = Nevow.Athena.Widget.get(scrollNode);

        /*
         * When the scroll widget is fully initialized, select the first row in
         * it.
         */
        self.scrollWidget.initializationDeferred.addCallback(
            function(passthrough) {
                return self.scrollWidget._selectFirstRow().addCallback(
                    function(ignored) {
                        self.initializationDeferred.callback(null);
                        return passthrough;
                    });
            });

        self.scrolltableContainer = self.scrollWidget.node.parentNode;
        self.groupActionsForm = Nevow.Athena.FirstNodeByAttribute(
                                    self.contentTableGrid[1][1], "name", "group-actions");

        self.nextMessagePreview = self.firstWithClass(
            self.contentTableGrid[1][2],
            "next-message-preview");

        /*
         * See L{_getActionButtons} for description of the structure of
         * C{actions}.
         */
        self.actions = self._getActionButtons();

        self._setupActionButtonsForView(self.scrollWidget.viewSelection['view']);

        self.delayedLoad(self.complexityLevel);
    },

    /**
     * level = integer between 1 and 3
     * node = the image that represents this complexity level
     * report = boolean - should we persist this change
     */
    function setComplexity(self, level, node, report) {
        if (node.className == "selected-complexity-icon") {
            return;
        }

        self._setComplexityVisibility(level);
        self.complexityLevel = level;

        if (report) {
            self.callRemote("setComplexity", level);
        }

        var gparent = node.parentNode.parentNode;
        var selected = Nevow.Athena.FirstNodeByAttribute(gparent, "class", "selected-complexity-icon");

        selected.className = "complexity-icon";
        self.complexityHover(selected);
        if (!report) {
            self.complexityHover(node);
        }
        node.className = "selected-complexity-icon";
        self.recalculateMsgDetailWidth(false);
    },

    /**
     * Called whenever the selected message changes.
     *
     * This implementation updates the message detail area of the Controller
     * which is the parent widget of this widget.  It returns a Deferred which
     * fires when this has been completed.
     */
    function selectionChanged(self, webID) {
        if (webID == null) {
            self.clearMessageDetail();
            return Divmod.Defer.succeed(null);
        } else {
            return self.updateMessageDetail(webID);
        }
    },

    /**
     * Return an object with view names as keys and objects defining the
     * actions available to those views as values.  The value objects have
     * action names as keys and objects with two properties as values:
     * C{button}, bound to the DOM node which represents the action's button;
     * C{enable}, bound to a boolean indicating whether this action is
     * available to this view.
     */
    function _getActionButtons(self) {
        var buttonInfo = {
            "all": ["defer", "delete", "forward",
                    "reply", "print", "train-spam", "unarchive"],
            "inbox": ["archive", "defer", "delete",
                      "forward", "reply", "print", "train-spam"],
            "spam": ["delete", "train-ham"],
            "deferred": ["forward", "reply", "print"],
            "sent": ["delete", "forward", "reply", "print"],
            "trash": ["forward" ,"reply", "print", "undelete"]};

        /*
         * Compute list of all button names from the buttonInfo structured.
         */
        var view, i, j;
        var allButtonNames = [];
        for (view in buttonInfo) {
            for (i = 0; i < buttonInfo[view].length; ++i) {
                /*
                 * Try to find this button in the list of all button names
                 */
                for (j = 0; j < allButtonNames.length; ++j) {
                    if (buttonInfo[view][i] == allButtonNames[j]) {
                        break;
                    }
                }
                /*
                 * Didn't break out of the loop -- didn't find the name, so add
                 * it.
                 */
                if (j == allButtonNames.length) {
                    allButtonNames.push(buttonInfo[view][i]);
                }
            }
        }

        function difference(minuend, subtrahend) {
            var i, j;
            var diff = [];
            for (i = 0; i < minuend.length; ++i) {
                for (j = 0; j < subtrahend.length; ++j) {
                    if (minuend[i] == subtrahend[j]) {
                        break;
                    }
                }
                if (j == subtrahend.length) {
                    diff.push(minuend[i]);
                }
            }
            return diff;
        }

        function getActionButton(name) {
            return Divmod.Runtime.theRuntime.firstNodeByAttribute(
                self.messageActions, "class", name + "-button");
        }

        var views = {};
        var actions;
        var actionName;
        for (view in buttonInfo) {
            actions = {};
            for (i = 0; i < buttonInfo[view].length; ++i) {
                actionName = buttonInfo[view][i];
                actions[actionName] = {
                    "button": getActionButton(actionName),
                    "enable": true};
            }
            hide = difference(allButtonNames, buttonInfo[view]);
            for (i = 0; i < hide.length; ++i) {
                actionName = hide[i];
                actions[actionName] = {
                    "button": getActionButton(actionName),
                    "enable": false};
            }
            views[view] = actions;
        }
        return views;
    },

    function _getViewCountNode(self, view) {
        var viewNode = self.mailViewNodes[view];
        if (viewNode === undefined || viewNode === null) {
            throw new Error("Request for invalid view: " + view);
        }
        var count = Divmod.Runtime.theRuntime.firstNodeByAttribute(
            viewNode.parentNode, 'class', 'count').firstChild;
        return count;
    },

    /**
     * Return the count of unread messages in the given view.
     *
     * @param view: One of "all", "inbox", "spam" or "sent".
     */
    function getUnreadCountForView(self, view) {
        return parseInt(self._getViewCountNode(view).nodeValue);
    },

    function setUnreadCountForView(self, view, count) {
        var countNode = self._getViewCountNode(view);
        countNode.nodeValue = String(count);
    },

    /**
     * @return: an array of objects with C{name} and C{key} properties bound to
     * the name and unique server-side identifier for each person being
     * displayed in the view selection chooser.
     */
    function getPeople(self) {
        var people = [];
        var personChooser = Divmod.Runtime.theRuntime.firstNodeByAttribute(
            self.contentTableGrid[0][0], 'class', 'person-chooser');
        var personChoices = Divmod.Runtime.theRuntime.nodesByAttribute(
            personChooser, 'class', 'list-option');
        var nameNode, keyNode;
        var name, key;
        for (var i = 0; i < personChoices.length; ++i) {
            nameNode = Divmod.Runtime.theRuntime.firstNodeByAttribute(
                personChoices[i], 'class', 'opt-name');
            keyNode = Divmod.Runtime.theRuntime.firstNodeByAttribute(
                personChoices[i], 'class', 'person-key');
            name = nameNode.firstChild.nodeValue;
            key = keyNode.firstChild.nodeValue;
            people.push({name: name, key: key});
        }
        return people;
    },

    function _getContentTableGrid(self) {
        self.inboxContent = self.firstNodeByAttribute("class", "inbox-content");
        var firstByTagName = function(container, tagName) {
            return self.getFirstElementByTagNameShallow(container, tagName);
        }
        var contentTableContainer = Divmod.Runtime.theRuntime.getElementsByTagNameShallow(
                                        self.inboxContent, "div")[1];
        var contentTable = firstByTagName(contentTableContainer, "table");
        var contentTableRows = Divmod.Runtime.theRuntime.getElementsByTagNameShallow(
                                    firstByTagName(contentTable, "tbody"), "tr");
        var contentTableGrid = [];

        for(var i = 0; i < contentTableRows.length; i++) {
            contentTableGrid.push(
                Divmod.Runtime.theRuntime.getElementsByTagNameShallow(
                    contentTableRows[i], "td"));
        }
        return {table: contentTable, grid: contentTableGrid};
    },

    function _getContentTableColumn(self, offset) {
        return MochiKit.Base.map(
            function(r) {
                if(offset+1 <= r.length) {
                    return r[offset];
                }
            }, self.contentTableGrid);
    },

    function rowsFetched(self, count) {
        if(0 < count && self._batchSelection) {
            var pred = self._batchSelectionPredicates[self._batchSelection];
            self.scrollWidget.massSelectOrNot(true, pred);
        }
    },

    /**
     * XXX
     */
    function changeBatchSelectionByNode(self, buttonNode) {
        /*
         * This doesn't actually use the button node, since it has essentially
         * nothing to do with the state of the batch selection nodes in the
         * DOM.
         */
        var selectNode = Divmod.Runtime.theRuntime.firstNodeByAttribute(
            self.node, 'name', 'batch-type');
        return self.changeBatchSelection(selectNode.value);
    },

    /**
     * XX
     */
    function changeBatchSelection(self, to) {
        var args = [to != "none"];
        if(to in self._batchSelectionPredicates) {
            args.push(self._batchSelectionPredicates[to]);
        }

        /* we can't actually do anything useful with this count, like
         * only enabling aggregate actions if it's > 0 because there
         * could be as-yet unrequested rows that the action will affect.
         * we could probably treat is as meaningful if we know we've
         * already requested all of the rows, but that's not so important
         * right now */
        var count = self.scrollWidget.massSelectOrNot.apply(self.scrollWidget, args);
        if(to == "none") {
            self._changeGroupActionAvailability(false);
            self._batchSelection = null;
        } else {
            self._changeGroupActionAvailability(true);
            self._batchSelection = to;
        }
    },

    /**
     * Return a two element list.  The first element will be a sequence
     * of web IDs for currently selected messages who do not fit the batch
     * selection criteria, and the second element will be a sequence of
     * web IDs for messages who fit the batch selection criteria but are
     * not currently selected.  Both lists may be empty
     */
    function getBatchExceptions(self) {
        var row, webID,
            sw = self.scrollWidget,
            sel = self._batchSelection,
            pred = self._batchSelectionPredicates[sel],
            include = [],
            exclude = [];

        if(!pred) {
            pred = function(r) {
                /* always true for "all", always false for "none" */
                return sel == "all";
            }
        }

        for(var i = 0; i < sw.model.rowCount(); i++) {
            row = sw.model.getRowData(i);
            if(row != undefined) {
                webID = row["__id__"];
                /* if it's selected */
                if (webID in sw.selectedGroup) {
                    /* and it doesn't fulfill the predicate */
                    if (!pred(row)) {
                        /* then mark it for explicit inclusion */
                        include.push(webID);
                    }
                /* or it's not selected and does fulfill the predicate */
                } else if (pred(row)) {
                    /* then mark it for explicit exclusion */
                    exclude.push(webID);
                }
            }
        }
        return [include, exclude];
    },

    function _removeRows(self, rows) {
        /*
         * This action is removing rows from visibility.  Drop them
         * from the model.  Change the currently selected row, if
         * necessary.
         */
        var i, row, index, removed = 0;
        var indices = self.scrollWidget.model.getRowIndices();
        var removalDeferreds = [];

        for (i = 0; i < indices.length; ++i) {
            index = indices[i] - removed;
            row = self.scrollWidget.model.getRowData(index);
            if (row.__id__ in self.scrollWidget.selectedGroup) {
                removalDeferreds.push(self.scrollWidget.removeRow(index));
                removed += 1;
            }
        }

        return Divmod.Defer.gatherResults(removalDeferreds).addCallback(
            function(ignored) {
                return self.scrollWidget.scrolled().addCallback(
                    function(ignored) {
                        /*
                         * XXX - Selecting the first row is wrong - we should select a
                         * row very near to the previously selected row, instead.
                         */
                        if (self.scrollWidget.getSelectedRow() == null) {
                            return self.scrollWidget._selectFirstRow();
                        }
                    });
            });
    },

    /**
     * Call the given function after setting the message detail area's opacity
     * to 0.2.  Set the message detail area's opacity back to 1.0 after the
     * Deferred the given function returns has fired.
     */
    function withReducedMessageDetailOpacity(self, callable) {
        self.messageDetail.style.opacity = 0.2;
        var result = callable();
        result.addBoth(
            function(passthrough) {
                self.messageDetail.style.opacity = 1.0;
                return passthrough;
            });
        return result;
    },

    function touchBatch(self, action, isDestructive) {
        var exceptions = self.getBatchExceptions();
        var include = exceptions[0];
        var exclude = exceptions[1];

        var result = self.withReducedMessageDetailOpacity(
            function() {
                var acted = self.callRemote(
                    "actOnMessageBatch", action, self.scrollWidget.viewSelection,
                    self._batchSelection, include, exclude);
                acted.addCallback(
                    function(counts) {
                        var readTouchedCount = counts[0];
                        var unreadTouchedCount = counts[1];

                        if (isDestructive) {
                            var result = self._removeRows(self.scrollWidget.selectedGroup);
                            self.scrollWidget.selectedGroup = {};
                            return result;
                        }
                        return null;

                    });
                return acted;
            });
        return result;
    },

    /**
     * similar to C{getElementsByTagNameShallow}, but returns the
     * first matching element
     */
    function getFirstElementByTagNameShallow(self, node, tagName) {
        var child;
        for(var i = 0; i < node.childNodes.length; i++) {
            child = node.childNodes[i];
            if(child.tagName && child.tagName.toLowerCase() == tagName) {
                return child;
            }
        }
    },

    /**
     * Decrement the unread message count that is displayed next
     * to the name of the view called C{viewName} C{byHowMuch}
     *
     * @param viewName: string
     * @param byHowMuch: number
     * @return: undefined
     */
    function decrementMailViewCount(self, viewName, byHowMuch) {
        self.setUnreadCountForView(
            viewName,
            self.getUnreadCountForView(viewName) - byHowMuch);
    },

    /**
     * Decrement the unread message count that is displayed next to
     * the name of the currently active view in the view selector.
     *
     * (e.g. "Inbox (31)" -> "Inbox (30)")
     */
    function decrementActiveMailViewCount(self, byHowMuch/*=1*/) {
        if(byHowMuch == undefined) {
            byHowMuch = 1;
        }

        self.decrementMailViewCount(
            self.scrollWidget.viewSelection["view"], byHowMuch);
    },

    /**
     * Update the counts that are displayed next
     * to the names of mailbox views in the view selector
     *
     * @param counts: mapping of view names to unread
     *                message counts
     */
    function updateMailViewCounts(self, counts) {
        var cnode;
        for(var k in counts) {
            cnode = self.firstWithClass(self.mailViewNodes[k], "count");
            cnode.firstChild.nodeValue = counts[k];
        }
    },

    function delayedLoad(self, complexityLevel) {
        setTimeout(function() {
            self.setScrollTablePosition("absolute");
            self.highlightExtracts();
            self.setInitialComplexity(complexityLevel).addCallback(
                function() {
                    self.finishedLoading();
                    self.resized(true);
                });
        }, 0);
    },

    function setInitialComplexity(self, complexityLevel) {
        var cc = self.firstWithClass(self.node, "complexity-icons");
        self.setComplexity(complexityLevel,
                            cc.getElementsByTagName("img")[3-complexityLevel],
                            false);
        /* firefox goofs the table layout unless we make it
            factor all three columns into it.  the user won't
            actually see anything strange */
        if(complexityLevel == 1) {
            var D = Divmod.Defer.Deferred();
            self._setComplexityVisibility(3);
            /* two vanilla calls aren't enough, firefox won't
                update the viewport */
            setTimeout(function() {
                self._setComplexityVisibility(1);
                D.callback(null);
            }, 1);
            return D;
        }
        return Divmod.Defer.succeed(null);
    },


    function getHeight(self) {
        /* This is the cumulative padding/margin for all elements whose
         * heights we factor into the height calculation below.  clientHeight
         * includes border but not padding or margin.
         * FIXME: change all this code to use offsetHeight, not clientHeight
         */
        var basePadding = 14;
        return (Divmod.Runtime.theRuntime.getPageSize().h -
                self.messageBlockYPos -
                self.totalFooterHeight -
                basePadding);

    },


    /**
     * resize the inbox table and contents.
     * @param initialResize: is this the first/initial resize?
     *                       (if so, then our layout constraint jiggery-pokery
     *                        is not necessary)
     */
    function resized(self, initialResize) {
        var getHeight = function(node) {
            return Divmod.Runtime.theRuntime.getElementSize(node).h;
        }
        var setHeight = function(node, height) {
            if(0 < height) {
                node.style.height = height + "px";
            }
        }

        if(!self.totalFooterHeight) {
            var blockFooter = self.firstNodeByAttribute("class", "right-block-footer");
            self.blockFooterHeight = getHeight(blockFooter);
            self.totalFooterHeight = self.blockFooterHeight + 5;
        }

        var swHeight = self.getHeight();
        setHeight(self.contentTableGrid[0][1], swHeight);
        setHeight(self.scrollWidget._scrollViewport, swHeight);

        setHeight(self.messageDetail, (Divmod.Runtime.theRuntime.getPageSize().h -
                                       self.ypos - 14 -
                                       self.totalFooterHeight));

        setTimeout(
            function() {
                self.recalculateMsgDetailWidth(initialResize);
            }, 0);
    },

    function recalculateMsgDetailWidth(self, initialResize) {
        if(!self.initialResize) {
            self.messageDetail.style.width = "100%";
        }

        document.body.style.overflow = "hidden";
        self.messageDetail.style.overflow = "hidden";

        self.messageDetail.style.width = Divmod.Runtime.theRuntime.getElementSize(
                                            self.messageDetail).w + "px";

        self.messageDetail.style.overflow = "auto";
        document.body.style.overflow = "auto";
    },

    function finishedLoading(self) {
        self.node.removeChild(self.firstWithClass(self.node, "loading"));
    },

    function firstWithClass(self, n, cls) {
        return Nevow.Athena.FirstNodeByAttribute(n, "class", cls);
    },

    function complexityHover(self, img) {
        if(img.className == "selected-complexity-icon") {
            return;
        }
        if(-1 < img.src.search("unselected")) {
            img.src = img.src.replace("unselected", "selected");
        } else {
            img.src = img.src.replace("selected", "unselected");
        }
    },

    function _groupSetDisplay(self, nodes, display) {
        for(var i = 0; i < nodes.length; i++) {
            if(nodes[i]) {
                nodes[i].style.display = display;
            }
        }
    },

    function hideAll(self, nodes) {
        self._groupSetDisplay(nodes, "none");
    },

    function showAll(self, nodes) {
        self._groupSetDisplay(nodes, "");
    },

    function _setComplexityVisibility(self, c) {
        var fontSize;
        var messageBody;

        if (c == 1) {
            self.contentTableGrid[0][0].style.display = "none";
            self.contentTableGrid[1][0].style.display = "none";
            self.hideAll(self._getContentTableColumn(1));
            self.setScrollTablePosition("absolute");
            self.viewShortcutSelect.style.display = "";
            /* use the default font-size, because complexity 1 is the default
             * complexity.
             */
            fontSize = "";
        } else if (c == 2) {
            self.contentTableGrid[0][0].style.display = "none";
            self.contentTableGrid[1][0].style.display = "none";
            self.showAll(self._getContentTableColumn(1));
            self.setScrollTablePosition("static");
            self.viewShortcutSelect.style.display = "";
            fontSize = "1.3em";
        } else if (c == 3) {
            self.viewShortcutSelect.style.display = "none";
            self.contentTableGrid[0][0].style.display = "";
            self.contentTableGrid[1][0].style.display = "";
            self.showAll(self._getContentTableColumn(1));
            self.setScrollTablePosition("static");
            fontSize = "1.3em";
        }

        try {
            messageBody = self.firstWithClass(self.messageDetail, "message-body");
            messageBody.style.fontSize = fontSize;
        } catch (e) {
            0;
        }

        /* store this for next time we load a message in this complexity level
         */
        self.fontSize = fontSize;
    },

    function setScrollTablePosition(self, p) {
        self.scrolltableContainer.style.position = p;
        var d;
        if(p == "absolute") {
            d = "none";
        } else {
            d = "";
        }
    },

    function fastForward(self, toMessageID) {
        return self.withReducedMessageDetailOpacity(
            function() {
                return self.callRemote("fastForward", self.scrollWidget.viewSelection, toMessageID).addCallback(
                    function(messageData) {
                        var rowData = null;
                        try {
                            rowData = self.scrollWidget.model.findRowData(toMessageID);
                        } catch (err) {
                            if (err instanceof Mantissa.ScrollTable.NoSuchWebID) {
                                /*
                                 * Someone removed the row we were going to display.  Oh well, do nothing, instead.
                                 */

                            } else {
                                throw err;
                            }
                        }
                        if (rowData != null) {
                            rowData.read = true;
                            return self.setMessageContent(messageData[0], messageData[1], messageData[2]);
                        }
                    });
            });
    },

    /**
     * Change the view being viewed.
     *
     * @param key: The parameter of the view to change.  One of C{"view"},
     * C{"tag"}, C{"person"}, or C{"account"}.
     *
     * @param value: The new value of the given view parameter.
     *
     * @return: A Deferred which fires when the view selection has been changed
     * and a new set of messages is being displayed.
     */
    function changeViewSelection(self, key, value) {
        return self.scrollWidget.changeViewSelection(key, value).addCallback(
            function(messageCount) {
                if (messageCount) {
                    self.messageActions.style.visibility = "";
                } else {
                    self.messageActions.style.visibility = "hidden";
                }
            });
    },

    /**
     * Change the class of the given node to C{"selected-list-option"}, change
     * the class of any existing selected nodes in the same select group to
     * C{"list-option"}, and change the C{onclick} handler of those nodes to be
     * the same as the C{onclick} handler for the given node.
     */
    function _selectListOption(self, n) {
        var sibs = n.parentNode.childNodes;
        for(var i = 0; i < sibs.length; i++) {
            if(sibs[i].className == "selected-list-option") {
                sibs[i].className = "list-option";
                if(!sibs[i].onclick) {
                    sibs[i].onclick = n.onclick;
                }
            }
        }
        n.className = "selected-list-option";
    },

    /**
     * Select a tag by its DOM node.
     */
    function chooseTagByNode(self, tagNode) {
        var tagName = Divmod.Runtime.theRuntime.firstNodeByAttribute(
            tagNode, 'class', 'opt-name');
        self._selectListOption(tagNode);
        return self.chooseTag(tagName.firstChild.nodeValue.toLowerCase());
    },

    /**
     * Select a new tag from which to display messages.  Adjust local state to
     * indicate which tag is being viewed and, if necessary, ask the server
     * for the messages to display.
     *
     * @type tagName: string
     * @param tagName: The tag to select.
     */
    function chooseTag(self, tagName) {
        if (tagName == 'all') {
            tagName = null;
        }
        return self.changeViewSelection("tag", tagName);
    },

    /**
     * Add the given tags as options inside the "View By Tag" element
     */
    function addTagsToViewSelector(self, taglist) {
        var tc = self.firstWithClass(self.contentTableGrid[0][0], "tag-chooser");
        var choices = tc.getElementsByTagName("span");
        var currentTags = [];
        for(var i = 0; i < choices.length; i++) {
            currentTags.push(choices[i].firstChild.nodeValue);
        }
        var needToAdd = Quotient.Common.Util.difference(taglist, currentTags);
        /* the tags are unordered at the moment, probably not ideal */
        for(i = 0; i < needToAdd.length; i++) {
            tc.appendChild(
                MochiKit.DOM.DIV({"class": "list-option",
                                  "onclick": function() {
                                      self.chooseTagByNode(this);
                                    }}, MochiKit.DOM.SPAN({"class": "opt-name"}, needToAdd[i])));
        }
    },

    /**
     * Call chooseMailView with the view name contained in the child node of
     * C{viewNode} with class "opt-name".
     */
    function chooseMailViewByNode(self, viewNode) {
        var view = Divmod.Runtime.theRuntime.firstNodeByAttribute(
            viewNode, 'class', 'opt-name');
        return self.chooseMailView(view.firstChild.nodeValue.toLowerCase());
    },

    /**
     * Call chooseMailView with the view contained in the value of attribute
     * of the view shortcut <select> C{shortcutNode}
     */
    function chooseMailViewByShortcutNode(self, shortcutNode) {
        return self.chooseMailView(shortcutNode.value);
    },

    /**
     * Select a new, semantically random set of messages to display.  Adjust
     * local state to indicate which random crap is being viewed and, if
     * necessary, ask the server for the messages to display.
     *
     * @param viewName: the name of the view to switch to
     * @return: L{Deferred}, which will fire after view change is complete
     */
    function chooseMailView(self, viewName) {
        self.disableGroupActions();
        self._selectViewShortcut(viewName);
        self._selectListOption(self.mailViewNodes[viewName].parentNode);
        self._setupActionButtonsForView(viewName);
        return self.changeViewSelection("view", viewName);
    },

    function _setupActionButtonsForView(self, viewName) {
        var enableActionNames = [];

        var actions = self.actions[viewName];
        if (actions === undefined) {
            throw new Error("Unknown view: " + viewName);
        }
        for (var actionName in actions) {
            if (actions[actionName].enable) {
                enableActionNames.push(actionName);
                actions[actionName].button.style.display = "";
            } else {
                actions[actionName].button.style.display = "none";
            }
        }
        self.setGroupActions(enableActionNames);
    },

    /**
     * Select the view shortcut link that corresponds to the
     * current mail view, if any.
     */
    function _selectViewShortcut(self, viewName) {
        var current = viewName;
        var options = self.viewShortcutSelect.getElementsByTagName("option");
        for(var i = 0; i < options.length; i++) {
            if(options[i].value == current) {
                self.viewShortcutSelect.selectedIndex = i;
                break;
            }
        }
    },

    /**
     * Internet Explorer doesn't honour the "display" CSS property
     * or the "disabled" attribute on <option> nodes, so each time
     * the list of available actions needs to change, we'll just
     * remove all of the nodes in the group action <select> and
     * replace them with the ones that we know we need.
     *
     * @param: array of available action names.  (e.g. train-ham,
     *         train-spam, delete, archive, defer)
     * @return: undefined
     */
    function setGroupActions(self, actionNames) {
        var select = self.groupActionsForm.elements["group-action"];

        while (select.firstChild) {
            select.removeChild(select.firstChild);
        }

        var nameToDisplay = {"train-ham": "Not Spam",
                             "train-spam": "Is Spam",
                             "delete": "Delete",
                             "undelete": "Undelete",
                             "archive": "Archive",
                             "unarchive": "Unarchive",
                             "defer": "Defer"};

        var option, label, name;
        for (var i = 0; i < actionNames.length; i++) {
            name = actionNames[i];

            /* XXX hack.  we should be able to defer multiple msgs */
            if(name == "defer") {
                continue;
            }

            if (nameToDisplay[name] !== undefined) {
                label = document.createTextNode(nameToDisplay[name]);
                option = document.createElement('option');
                option.setAttribute('value', name);
                option.appendChild(label);
                select.appendChild(option);
            }
        }
    },


    /**
     * Select a new account by DOM node.
     */
    function chooseAccountByNode(self, accountNode) {
        var accountName = Divmod.Runtime.theRuntime.firstNodeByAttribute(
            accountNode, 'class', 'opt-name');
        self._selectListOption(accountNode);
        return self.chooseAccount(accountName.firstChild.nodeValue);
    },

    /**
     * Select a new account, the messages from which to display.  Adjust local
     * state to indicate which account's messages are being viewed and, if
     * necessary, ask the server for the messages to display.
     *
     * @param accountName: The name of the account to view messages from.
     * @return: C{undefined}
     */
    function chooseAccount(self, accountName) {
        if (accountName == 'all') {
            accountName = null;
        }

        return self.changeViewSelection("account", accountName);
    },

    /**
     * Select a new person by DOM node.
     */
    function choosePersonByNode(self, personNode) {
        var personKey = Divmod.Runtime.theRuntime.firstNodeByAttribute(
            personNode, 'class', 'person-key');
        self._selectListOption(n);
        return self.choosePerson(personKey.firstChild.nodeValue);
    },

    /**
     * Select a new person, the messages from which to display.  Adjust local
     * state to indicate which person's messages are being viewed and, if
     * necessary, ask the server for the messages to display.
     *
     * @param n: The node which this input handler is attached to.
     * @return: C{undefined}
     */
    function choosePerson(self, personKey) {
        return self.changeViewSelection("person", personKey);
    },

    function setupMailViewNodes(self) {
        if (!self.mailViewBody) {
            var mailViewPane = self.firstWithClass(self.contentTableGrid[0][0], "view-pane-content");
            var mailViewBody = self.firstWithClass(mailViewPane, "pane-body");
            self.mailViewBody = self.getFirstElementByTagNameShallow(mailViewBody, "div");
        }

        var nodes = {"all": null, "trash": null, "sent": null,
                     "spam": null, "inbox": null, "deferred": null};
        var e, nameNode, name;

        for(var i = 0; i < self.mailViewBody.childNodes.length; i++) {
            e = self.mailViewBody.childNodes[i];
            try {
                nameNode = Divmod.Runtime.theRuntime.firstNodeByAttribute(
                    e, 'class', 'opt-name');
            } catch (err) {
                if (err instanceof Divmod.Runtime.NodeAttributeError) {
                    continue;
                }
                throw err;
            }
            name = nameNode.firstChild.nodeValue.toLowerCase();
            nodes[name] = e.firstChild.nextSibling;
        }
        self.mailViewNodes = nodes;
    },

    /**
     * Tell the server to perform some action on the currently visible
     * message.
     *
     * @param action: A string describing the action to be performed.  One of::
     *
     *     "archive"
     *     "delete"
     *     "defer"
     *     "trainSpam"
     *     "trainHam"
     *
     * @param isProgress: A boolean indicating whether the message will be
     * removed from the current message list and the progress bar updated to
     * reflect this.
     *
     * @param arguments: An optional extra object to pass to the server-side
     * action handler.
     *
     * @return: C{undefined}
     */
    function touch(self, action, isProgress, /* optional */ extraArguments) {
        var model = self.scrollWidget.model;
        var selected = self.scrollWidget._selectedRowID;

        if (extraArguments === undefined) {
            extraArguments = null;
        }

        if (selected === undefined) {
            throw new Error("No row selected.");
        }

        var result = self.withReducedMessageDetailOpacity(
            function() {
                var nextMessageID = model.findNextRow(selected);
                if (!nextMessageID) {
                    nextMessageID = model.findPrevRow(selected);
                }

                var acted = self.callRemote("actOnMessageIdentifierList", action, [selected], extraArguments);

                var removed;
                if (isProgress) {
                    /*
                     * I know that this is removing the current row so I know
                     * that the Deferred fires synchronously and never fails so
                     * I don't have to add a callback or errback.
                     */
                    removed = self.scrollWidget.removeRow(self.scrollWidget.model.findIndex(selected));

                    /*
                     * This Deferred, however, is asynchronous.
                     */
                    if (nextMessageID) {
                        removed = self.scrollWidget._selectWebID(nextMessageID);
                    }
                } else {
                    removed = Divmod.Defer.succeed(null);
                }

                var scrolled = self.scrollWidget.scrolled();

                return Divmod.Defer.gatherResults([acted, removed, scrolled]);
            });
        return result;
    },

    /**
     * Like L{touch}, but acts upon the set of currently selected
     * messages in the scrolltable.
     *
     * @param isDestructive: does this action remove messages from the current
     *                       view?  this is subtly different to touchSelectedGroup's
     *                       "isProgress", because even for destructive message
     *                       actions, we might not need to request a new message
     *                       if the currently selected one is not a member of the
     *                       group being acted upon.
     */
    function touchSelectedGroup(self, action, isDestructive) {
        self.disableGroupActions();
        var result = self.withReducedMessageDetailOpacity(
            function() {
                var acted = self.callRemote(
                    "actOnMessageIdentifierList", action,
                    Divmod.dir(self.scrollWidget.selectedGroup));
                acted.addCallback(
                    function(counts) {
                        var readTouchedCount = counts[0];
                        var unreadTouchedCount = counts[1];

                        if (isDestructive) {
                            var result = self._removeRows(self.scrollWidget.selectedGroup);
                            self.scrollWidget.selectedGroup = {};
                            return result;
                        } else {
                            self.enableGroupActions();
                            return null;
                        }

                    });
                return acted;
            });
        return result;
    },

    /**
     * Adjust the unread message counts.  Typically called after
     * performing a destructive action.  Takes into account the
     * destination of a set of messages by looking at the current
     * view and the action that was performed.
     *
     * @param args: array of arguments passed to callRemote() to
     *              initiate the action server-side.  typically
     *              something like ["archiveCurrentMessage"] or
     *              ["trainMessageGroup", true]
     * @param affectedUnreadCount: number of unread messages
     *                             affected by the action.
     * @return: undefined
     */
    function adjustCounts(self, args, affectedUnreadCount) {
        if(affectedUnreadCount == 0) {
            return;
        }

        var suffixes = ["CurrentMessage", "MessageGroup", "MessageBatch"];
        var action = args[0];
        for(var i = 0; i < suffixes.length; i++) {
            if(action.substr(action.length-suffixes[i].length) == suffixes[i]) {
                action = action.substr(0, action.length-suffixes[i].length);
                break;
            }
        }
        self.decrementActiveMailViewCount(affectedUnreadCount);

        var addTo;

        if(action == "archive") {
            addTo = "all";
        } else if(action == "train") {
            if(args[args.length-1]) {
                addTo = "spam";
            } else {
                addTo = "inbox";
            }
        } else {
            return;
        }

        self.decrementMailViewCount(addTo, -affectedUnreadCount);
    },

    /**
     * Get the first node with class name C{className} below
     * C{parent}.  Repeated calls will yield cached results.
     *
     * At some point change calls to firstWithClass() to use this
     */
    function getFirstNode(self, parent, className) {
        if(!self._nodeCache) {
            self._nodeCache = {};
        }
        if(!(parent in self._nodeCache)) {
            self._nodeCache[parent] = {};
        }
        if(!(className in self._nodeCache[parent])) {
            self._nodeCache[parent][className] = Nevow.Athena.FirstNodeByAttribute(
                                                    parent, "class", className);
        }
        return self._nodeCache[parent][className];
    },

    /**
     * called by the scrolltable when the number of messages
     * in the message group selection transitions from 0->1
     * or 1->0.
     *
     * enables or disables group message actions, depending
     * on whether any messages are selected
     */
    function toggleGroupActions(self) {
        var form = self.groupActionsForm;
        var currentlyEnabled = !form.elements["group-action"].disabled;
        self._changeGroupActionAvailability(!currentlyEnabled);
    },

    function disableGroupActions(self) {
        self._changeGroupActionAvailability(false);
    },

    function enableGroupActions(self) {
        self._changeGroupActionAvailability(true);
    },

    /**
     * Return the node with the event handler which allows an action to be
     * applied to a group of messages.
     */
    function _getGroupActionPerformButton(self) {
        return self.getFirstNode(
            self.groupActionsForm.parentNode.parentNode,
            "group-action-perform");
    },

    /**
     * @param available: boolean.  true = enable, false = disable
     */
    function _changeGroupActionAvailability(self, available) {
        var form = self.groupActionsForm;
        var gap = self._getGroupActionPerformButton();
        var select = form.elements["group-action"];

        if(available) {
            select.style.opacity = gap.style.opacity = "";
            select.removeAttribute("disabled");
            gap.style.cursor = "";
            gap.onclick = function() {
                try {
                    var form = self.groupActionsForm;
                    var actionName = form.elements["group-action"].value;

                    if(actionName == "train-spam") {
                        actionName = "trainSpam";
                    } else if (actionName == "train-ham") {
                        actionName = "trainHam";
                    }
                    if (self._batchSelection) {
                        self.touchBatch(actionName, true);
                    } else {
                        self.touchSelectedGroup(actionName, true);
                    }
                } catch (err) {
                    Divmod.err(err);
                }
                return false;
            };
        } else {
            select.style.opacity = gap.style.opacity = ".3";
            select.setAttribute("disabled", "true");
            gap.style.cursor = "default";
            gap.onclick = function() {
                return false;
            }
        }
    },

    function archiveThis(self, n) {
        /*
         * Archived messages show up in the "all" view.  So, if we are in any
         * view other than that, this action should make the message
         * disappear.
         */
        self.touch("archive", self.scrollWidget.viewSelection["view"] != "all");
    },

    function unarchiveThis(self, n) {
        self.touch("unarchive", self.scrollWidget.viewSelection["view"] == "all");
    },

    function deleteThis(self, n) {
        self.touch("delete", self.scrollWidget.viewSelection["view"] != "trash");
    },

    function undeleteThis(self, n) {
        self.touch("undelete", self.scrollWidget.viewSelection["view"] == "trash");
    },

    function showDeferForm(self) {
        self.deferForm.style.display = "";
    },

    function hideDeferForm(self) {
        self.deferForm.style.display = "none";
    },

    function _deferralStringToPeriod(self, value) {
        if (value == "other...") {
            self.showDeferForm();
            return;
        }
        if (value == "Defer") {
            return null;
        }
        var args;
        if (value == "1 day") {
            return {"days": 1,
                    "hours": 0,
                    "minutes": 0};
        } else if (value == "1 hour") {
            return {"days": 0,
                    "hours": 1,
                    "minutes": 0};
        } else if (value == "12 hours") {
            return {"days": 0,
                    "hours": 12,
                    "minutes": 0};
        } else if (value == "1 week") {
            return {"days": 7,
                    "hours": 0,
                    "minutes": 0};
        } else {
            throw new Error("Invalid Deferral state:" + value);
        }
    },

    /**
     * Return an object describing the deferral period represented by the given
     * node, or null if it indicates no deferral should be performed or
     * something else if we should show the defer form.
     */
    function _getDeferralSelection(self, node) {
        var options = self.deferSelect.getElementsByTagName("option");
        var value = options[self.deferSelect.selectedIndex].firstChild.nodeValue;
        return self._deferralStringToPeriod(value);
    },

    function defer(self, /* unused */ node) {
        var period = self._getDeferralSelection();
        node.selectedIndex = 0;
        if (period === undefined || period === null) {
            return;
        }
        self.touch("defer", true, period);
    },

    /**
     * Return an object with three properties giving the current state of the
     * defer period form.
     */
    function _getDeferralPeriod(self) {
        var form = self.deferForm;
        return {'days': parseInt(form.days.value),
                'hours': parseInt(form.hours.value),
                'minutes': parseInt(form.minutes.value)};
    },

    function deferThis(self) {
        var period = self._getDeferralPeriod();
        self.deferForm.style.display = "none";
        return self.touch("defer", true, period);
    },

    /**
     * Remove all content from the message detail area and add the given node.
     */
    function setMessageDetail(self, node) {
        while (self.messageDetail.firstChild) {
            self.messageDetail.removeChild(self.messageDetail.firstChild);
        }
        self.messageDetail.appendChild(node);
    },

    function replyToThis(self) {
        /*
         * This brings up a composey widget thing.  When you *send* that
         * message (or save it as a draft or whatever, I suppose), *then* this
         * action is considered to have been taken, and the message should be
         * archived and possibly removed from the view.  But nothing happens
         * *here*.
         */
        var result = self.callRemote(
            "replyToMessage", self.scrollWidget.getSelectedRow().__id__);
        result.addCallback(
            function(composeInfo) {
                return self.addChildWidgetFromWidgetInfo(composeInfo);
            });
        result.addCallback(
            function(compose) {
                self.setMessageDetail(compose.node);
            });
        return result;
    },

    function forwardThis(self, n) {
        /*
         * See replyToThis
         */
        var result = self.callRemote(
            "forwardMessage", self.scrollWidget.getSelectedRow().__id__);
        result.addCallback(
            function(composeInfo) {
                return self.addChildWidgetFromWidgetInfo(composeInfo);
            });
        result.addCallback(
            function(compose) {
                self.setMessageDetail(compose.node);
            });
        return result;
    },

    /**
     * Instruct the server to train the spam filter using the current message
     * as an example of spam.  Remove the message from the message list if
     * appropriate.
     *
     * @return: A Deferred which fires when the training action has been
     * completed.
     */
    function _trainSpam(self) {
        return self.touch(
            "trainSpam",
            (self.scrollWidget.viewSelection["view"] != "spam"));
    },

    /**
     * Instruct the server to train the spam filter using the current message
     * as an example of spam.  Remove the message from the message list if
     * appropriate.
     *
     * @return: C{false}
     */
    function trainSpam(self) {
        self._trainSpam();
        return false;
    },

    /**
     * Instruct the server to train the spam filter using the current message
     * as an example of ham.  Remove the message from the message list if
     * appropriate.
     *
     * @return: A Deferred which fires when the training action has been
     * completed.
     */
    function _trainHam(self) {
        return self.touch(
            "trainHam",
            (self.scrollWidget.viewSelection["view"] == "spam"));
    },

    /**
     * Instruct the server to train the spam filter using the current message
     * as an example of ham.  Remove the message from the message list if
     * appropriate.
     *
     * @return: C{false}
     */
    function trainHam(self) {
        self._trainHam();
        return false;
    },

    function intermingle(self, string, regex, transformation) {
        var lpiece, mpiece, rpiece, piece, match;
        var pieces = [string];
        var matches = 0;

        while(true) {
            piece = pieces[pieces.length-1];
            match = regex.exec(piece);
            if(match) {
                matches++;
                lpiece = piece.slice(0, match.index);
                mpiece = match[0];
                rpiece = piece.slice(match.index+mpiece.length, piece.length);
                pieces.pop();
                pieces = pieces.concat([lpiece, transformation(mpiece), rpiece]);
            } else { break }
        }
        if(matches) {
            return pieces;
        }
        return null;
    },

    function transformURL(self, s) {
        var target = s
        if(Quotient.Common.Util.startswith('www', s)) {
            target = 'http://' + target;
        }
        return MochiKit.DOM.A({"href":target, "target": "_blank"}, s);
    },

    function highlightExtracts(self) {
        /* We have to fetch the message body node each time because it gets
         * removed from the document each time a message is loaded.  We wrap it
         * in a try/catch because there are some cases where it's not going
         * to be available, like the "out of messages" case.  it's easier to
         * determine this here than with logic someplace else */
        try {
            var messageBody = self.firstWithClass(self.messageDetail, "message-body");
        } catch(e) {
            return;
        }

        var replacements, replacement, replacementLen, j, elem;
        var i = 0;
        var regex = /(?:\w+:\/\/|www\.)[^\s\<\>\'\(\)\"]+[^\s\<\>\(\)\'\"\?\.]/;

        while(true) {
            elem = messageBody.childNodes[i];

            if(!elem) {
                break
            }

            if(elem.tagName) {
                i++;
                continue
            }

            replacements = self.intermingle(
                                elem.nodeValue, regex, self.transformURL);

            if(!replacements) {
                i++;
                continue
            }

            replacementLen = replacements.length;
            for(j = 0; j < replacementLen; j++) {
                replacement = replacements[j];
                if(!replacement.tagName) {
                    replacement = document.createTextNode(replacement);
                }
                messageBody.insertBefore(replacement, elem);
            }
            messageBody.removeChild(elem);
            i += j;
        }
    },

    /** Fragment-boundary-crossing proxy for
     * L{Quotient.Message.MessageDetail.printable}
     */
    function printable(self) {
        Quotient.Message.MessageDetail.get(
            self.firstWithClass(
                self.messageDetail, "message-detail-fragment")).printable();
    },

    /**
     * Empty the message detail view area of content.
     */
    function clearMessageDetail(self) {
        self.messageDetail.scrollTop = 0;
        self.messageDetail.scrollLeft = 0;

        var clearNodes = [self.messageDetail, self.nextMessagePreview];
        for (var i = 0; i < clearNodes.length; ++i) {
            while (clearNodes[i].firstChild) {
                clearNodes[i].removeChild(clearNodes[i].firstChild);
            }
        }
    },

    /**
     * Update the message detail area to display the specified message.  Return
     * a Deferred which fires when this has finished.
     */
    function updateMessageDetail(self, webID) {
        return self.fastForward(webID);
    },

    function onePattern(self, name) {
        if (name == "next-message") {
            return {
                'fillSlots': function(key, value) {
                    return '<div xmlns="http://www.w3.org/1999/xhtml">Next: ' + value + '</div>';
                }
            };
        } else if (name == "no-more-messages") {
            return '<span xmlns="http://www.w3.org/1999/xhtml">No more messages.</span>';
        } else {
            throw new Error("No such pattern: " + name);
        }
    },

    /**
     * @param data: Three-Array of the html for next message preview, the
     * html for the current message, and some structured data describing
     * the current message
     */
    function setMessageContent(self, nextMessagePreview, currentMessageDisplay, currentMessageData) {
        self.currentMessageData = currentMessageData;

        self.messageDetail.scrollTop = 0;
        self.messageDetail.scrollLeft = 0;

        return self.addChildWidgetFromWidgetInfo(currentMessageDisplay).addCallback(
            function(widget) {
                self.setMessageDetail(widget.node);

                var modifier, spamConfidence;

                if (currentMessageData.trained) {
                    spamConfidence = 'definitely';
                } else {
                    spamConfidence = 'probably';
                }
                if (currentMessageData.spam) {
                    modifier = '';
                } else {
                    modifier = 'not';
                }

                /* highlight the extracts here; the next message preview will
                 * be null for the last message, but we still want to
                 * highlight the extracts in that case.  it won't do any harm
                 * if there isn't actually a message body, as
                 * highlightExtracts() knows how to handle that */

                self.highlightExtracts();
                var pattern;
                if (nextMessagePreview != null) {
                    /* so this is a message, not a compose fragment
                     */
                    pattern = self.onePattern('next-message');
                    pattern = pattern.fillSlots('subject',
                                      nextMessagePreview['subject']);
                } else {
                    pattern = self.onePattern('no-more-messages');
                }
                Divmod.Runtime.theRuntime.setNodeContent(self.nextMessagePreview, pattern);

                /* if this is the "no more messages" pseudo-message,
                   then there won't be any message body */
                try {
                    var messageBody = self.firstWithClass(
                        self.messageDetail,
                        "message-body");
                } catch(e) {
                    return;
                }
                /* set the font size to the last value used in
                   _setComplexityVisibility() */
                messageBody.style.fontSize = self.fontSize;
            });
    });
