# -*- test-case-name: xquotient.test.test_compose -*-
from email import (Parser as P, Generator as G, MIMEMultipart as MMP,
                   MIMEText as MT, MIMEMessage as MM, MIMEBase as MB,
                   Header as MH, Charset as MC, Utils as EU, Encoders as EE)

import StringIO as S

from zope.interface import implements

from twisted.python.components import registerAdapter
from twisted.mail import smtp

from nevow import inevow, rend, json
from nevow.athena import expose

from axiom import attributes, item, scheduler
from axiom.upgrade import registerUpgrader, registerAttributeCopyingUpgrader

from xmantissa.fragmentutils import dictFillSlots
from xmantissa import webnav, ixmantissa, people, liveform, prefs
from xmantissa.scrolltable import ScrollingFragment
from xmantissa.webtheme import getLoader

from xquotient import iquotient, equotient, renderers, mimeutil, smtpout
from xquotient.exmess import Message, MessageDetail
from xquotient.mimestorage import Part



class Composer(item.Item, item.InstallableMixin):
    implements(ixmantissa.INavigableElement, iquotient.IMessageSender)

    typeName = 'quotient_composer'
    schemaVersion = 3

    installedOn = attributes.reference()

    def installOn(self, other):
        super(Composer, self).installOn(other)
        other.powerUp(self, ixmantissa.INavigableElement)
        other.powerUp(self, iquotient.IMessageSender)


    def getTabs(self):
        return [webnav.Tab('Mail', self.storeID, 0.6, children=
                    [webnav.Tab('Compose', self.storeID, 0.1)],
                authoritative=False)]


    def sendMessage(self, fromAddress, toAddresses, msg):
        """
        Send a message from this composer.

        @param toAddresses: List of email addresses (Which can be
            coerced to L{smtp.Address}es).
        @param msg: The L{exmess.Message} to send.
        """
        m = smtpout.MessageDelivery(composer=self, message=msg,
                                    store=self.store)
        m.send(fromAddress, toAddresses)


    def _createBounceMessage(self, log, toAddress, msg):
        """
        Create a multipart MIME message that will be sent to the user to indicate
        that their message has bounced.

        @param log: ???
        @param toAddress: The email address that bounced
        @param msg: The message that bounced

        @return: L{MP.MIMEMultipart}
        """
        bounceText = (
            'Your message to %(recipient)s, subject "%(subject)s", '
            'could not be delivered.')
        bounceText %= {
            'recipient': toAddress,
            'subject': msg.impl.getHeader(u'subject')}

        original = P.Parser().parse(msg.impl.source.open())

        m = MMP.MIMEMultipart(
            'mixed',
            None,
            [MT.MIMEText(bounceText, 'plain'),
             MT.MIMEText(log, 'plain'),
             MM.MIMEMessage(original)])

        m['Subject'] = 'Unable to deliver message to ' + toAddress
        m['From'] = '<>'
        m['To'] = ''
        return m


    def _sendBounceMessage(self, m):
        """
        Insert the given MIME message into the inbox for this user.

        @param m: L{MMP.MIMEMultipart}
        """
        s = S.StringIO()
        G.Generator(s).flatten(m)
        s.seek(0)
        self.createMessageAndQueueIt(
            smtpout.FromAddress.findDefault(self.store).address, s, False)


    def messageBounced(self, log, toAddress, msg):
        m = self._createBounceMessage(log, toAddress, msg)
        self._sendBounceMessage(m)


    def createMessageAndQueueIt(self, fromAddress, s, draft):
        """
        Create a message out of C{s}, from C{fromAddress}

        @param fromAddress: address from which to send the email
        @type fromAddress: C{unicode}
        @param s: message to send
        @type s: line iterable
        @type draft: C{bool}
        @param draft: Flag indicating whether this is a draft message or not
        (eg, a bounce message).

        @rtype: L{xquotient.exmess.Message}
        """
        def deliverMIMEMessage():
            # this doesn't seem to get called (yet?)
            md = iquotient.IMIMEDelivery(self.store)
            if draft:
                mr = md._createMIMEDraftReceiver('sent://' + fromAddress)
            else:
                mr = md.createMIMEReceiver('sent://' + fromAddress)
            for L in s:
                mr.lineReceived(L.rstrip('\n'))
            mr.messageDone()
            return mr.message
        return self.store.transact(deliverMIMEMessage)


    def createRedirectedMessage(self, fromAddress, toAddresses, message):
        """
        Create a L{Message} item based on C{message}, with the C{Resent-From}
        and C{Resent-To} headers set

        @type fromAddress: L{smtpout.FromAddress}

        @type toAddresses: sequence of L{mimeutil.EmailAddress}

        @type message: L{Message}

        @rtype: L{Message}
        """
        m = P.Parser().parse(message.impl.source.open())
        m['Resent-From'] = MH.Header(fromAddress.address).encode()
        m['Resent-To']  = MH.Header(mimeutil.flattenEmailAddresses(toAddresses)).encode()

        s = S.StringIO()
        G.Generator(s).flatten(m)
        s.seek(0)

        return self.createMessageAndQueueIt(fromAddress.address, s, True)


    def redirect(self, fromAddress, toAddresses, message):
        """
        Redirect C{message} from C{fromAddress} to C{toAddresses}.
        Parameters the same as for L{createRedirectedMessage}

        @rtype: C{None}
        """
        msg = self.createRedirectedMessage(fromAddress, toAddresses, message)
        addresses = [addr.email for addr in toAddresses]
        self.sendMessage(fromAddress, addresses, msg)


def upgradeCompose1to2(oldComposer):
    """
    Version 2 of the Composer powers up IMessageSender, which version 1 did
    not.  Correct that here.
    """
    newComposer = oldComposer.upgradeVersion(
        'quotient_composer', 1, 2,
        installedOn=oldComposer.installedOn)
    newComposer.installedOn.powerUp(
        newComposer, iquotient.IMessageSender)
    return newComposer

registerUpgrader(upgradeCompose1to2, 'quotient_composer', 1, 2)

item.declareLegacyItem(Composer.typeName, 2,
                       dict(installedOn=attributes.reference()))

def composer2to3(old):
    """
    Remove the L{Composer.fromAddress} attribute
    """
    return old.upgradeVersion(old.typeName, 2, 3,
                              installedOn=old.installedOn)

registerUpgrader(composer2to3, Composer.typeName, 2, 3)

class File(item.Item):
    typeName = 'quotient_file'
    schemaVersion = 1

    type = attributes.text(allowNone=False)
    body = attributes.path(allowNone=False)
    name = attributes.text(allowNone=False)

    message = attributes.reference()
    cabinet = attributes.reference(allowNone=False)

class FileCabinet(item.Item):
    typeName = 'quotient_file_cabinet'
    schemaVersion = 1

    name = attributes.text()
    filesCount = attributes.integer(default=0)

    def createFileItem(self, name, type, data):
        """
        @param name: file name
        @param type: content-type
        @param data: file contents

        @return: C{File} item
        """
        outf = self.store.newFile('cabinet-'+str(self.storeID),
                                  str(self.filesCount))
        outf.write(data)
        outf.close()

        f = File(store=self.store,
                 body=outf.finalpath,
                 name=name,
                 type=type,
                 cabinet=self)

        self.filesCount += 1
        return f

class FileCabinetPage(rend.Page):
    lastFile = None

    def __init__(self, original):
        rend.Page.__init__(self, original, docFactory=getLoader('file-upload'))

    def renderHTTP(self, ctx):
        req = inevow.IRequest(ctx)
        if req.method == 'POST':
            uploadedFileArg = req.fields['uploaddata']
            def txn():
                self.lastFile = self.original.createFileItem(
                                        name=unicode(uploadedFileArg.filename),
                                        type=unicode(uploadedFileArg.type),
                                        data=uploadedFileArg.file.read())
            self.original.store.transact(txn)

        return rend.Page.renderHTTP(self, ctx)

    def render_lastFileData(self, ctx, data):
        if self.lastFile is None:
            return ''
        return json.serialize({u'id': self.lastFile.storeID,
                               u'name': self.lastFile.name})

registerAdapter(FileCabinetPage, FileCabinet, inevow.IResource)

class _ComposeFragmentMixin:
    """
    Mixin which provides some stuff that might be useful to fragments which do
    composey things.

    Assumes it is mixed-in to something where C{self.composer} is a
    L{Composer}
    """

    def _coerceEmailAddressString(self, s):
        """
        Turn a string representation of one or more email addresses into a
        list of L{mimetuil.EmailAddress} instances

        @param s: non mime-encoded string
        @type s: C{str}

        @return: L{mimeutil.EmailAddress} instances
        @rtype: sequence
        """
        return mimeutil.parseEmailAddresses(s, mimeEncoded=False)

    def _getFromAddressStan(self):
        """
        Turn the L{smtpout.FromAddress} items in the L{Composer}'s store into some
        stan, using the C{from-select} and C{from-select-option} patterns from
        the template
        """
        fromAddrs = []
        for fromAddress in self.composer.store.query(smtpout.FromAddress):
            if fromAddress._default:
                fromAddrs.insert(0, fromAddress)
            else:
                fromAddrs.append(fromAddress)

        iq = inevow.IQ(self.docFactory)
        return iq.onePattern('from-select').fillSlots(
                        'options', [iq.onePattern(
                                    'from-select-option').fillSlots(
                                        'address', addr.address).fillSlots(
                                        'value', self.translator.toWebID(addr))
                                        for addr in fromAddrs])



    def getPeople(self):
        """
        @return: a sequence of pairs (name, email) for each Person in the
        store of my L{Composer}, where name is the person's display name, and
        email is their email address.  omits people without a display name or
        email address
        """
        peeps = []
        for person in self.composer.store.query(people.Person):
            email = person.getEmailAddress()
            if email is None:
                email = u''
            name = person.getDisplayName()
            if name or email:
                peeps.append((name, email))
        return peeps
    expose(getPeople)



class ComposeFragment(liveform.LiveFormFragment, renderers.ButtonRenderingMixin, _ComposeFragmentMixin):
    implements(ixmantissa.INavigableFragment)

    jsClass = u'Quotient.Compose.Controller'
    fragmentName = 'compose'

    _savedDraft = None

    def __init__(self, composer, recipients=None, subject=u'', messageBody=u'',
                 attachments=(), inline=False):
        """
        @type composer: L{Composer}

        @param recipients: email addresses of the recipients of this message.
        defaults to no recipients
        @type recipients: C{dict} which can contain any combination of the
        keys C{to}, C{cc} and C{bcc}, where the values are sequences of
        L{xquotient.mimeutil.EmailAddress} instances

        @param subject: the subject of this message
        @type subject: C{unicode}

        @param messageBody: the body of this message
        @type messageBody: C{unicode}

        @param attachments: the attachments of this message
        @type attachments: sequence of L{xquotient.mimepart.AttachmentPart}
        instances

        @param inline: whether the compose widget is being displayed inline,
        e.g. as a child of another widget
        @type inline: boolean

        C{toAddresses}, C{subject}, C{messageBody} and C{attachments} should
        be considered as presets - their values can be manipulated via the
        user interface
        """
        self.composer = composer
        self.translator = ixmantissa.IWebTranslator(composer.store)

        super(ComposeFragment, self).__init__(
            callable=self._sendOrSave,
            parameters=[liveform.Parameter(name='fromAddress',
                                           type=liveform.TEXT_INPUT,
                                           coercer=self.translator.fromWebID),
                        liveform.Parameter(name='toAddresses',
                                           type=liveform.TEXT_INPUT,
                                           coercer=self._coerceEmailAddressString),
                        liveform.Parameter(name='subject',
                                           type=liveform.TEXT_INPUT,
                                           coercer=unicode),
                        liveform.Parameter(name='messageBody',
                                           type=liveform.TEXTAREA_INPUT,
                                           coercer=unicode),
                        liveform.Parameter(name='cc',
                                           type=liveform.TEXT_INPUT,
                                           coercer=self._coerceEmailAddressString),
                        liveform.Parameter(name='bcc',
                                           type=liveform.TEXT_INPUT,
                                           coercer=self._coerceEmailAddressString),
                        liveform.Parameter(name='draft',
                                           type=liveform.CHECKBOX_INPUT,
                                           coercer=bool)])
        if recipients is None:
            recipients = {}
        self.recipients = recipients
        self.subject = subject
        self.messageBody = messageBody
        self.attachments = attachments
        self.fileAttachments = []
        self.inline = inline

        self.docFactory = None
        self.cabinet = self.composer.store.findOrCreate(FileCabinet)

    def invoke(self, formPostEmulator):
        coerced = self._coerced(formPostEmulator)
        # we want to allow the javascript to submit an
        # list of filenames of arbitrary length with the form
        coerced['files'] = formPostEmulator.get('files', ())
        return self.callable(**coerced)
    expose(invoke)


    def getInitialArguments(self):
        return (self.inline, self.getPeople())

    def render_attachButton(self, ctx, data):
        return inevow.IQ(self.docFactory).onePattern('attach-button')

    def render_inboxLink(self, ctx, data):
        from xquotient.inbox import Inbox
        return self.translator.linkTo(self.composer.store.findUnique(Inbox).storeID)

    def render_compose(self, ctx, data):
        req = inevow.IRequest(ctx)
        draftWebID = req.args.get('draft', [None])[0]

        iq = inevow.IQ(self.docFactory)
        attachmentPattern = iq.patternGenerator('attachment')
        attachments = []

        bodyPattern = iq.onePattern('message-body')
        subjectPattern = iq.onePattern('subject')

        if draftWebID is not None:
            draft = self.translator.fromWebID(draftWebID)
            # i think this will suffice until we have a rich text compose
            (alt,) = list(draft.message.impl.getTypedParts('multipart/alternative'))
            (txt,) = list(alt.getTypedParts('text/plain'))
            try:
                cc = draft.message.impl.getHeader(u'cc')
            except equotient.NoSuchHeader:
                cc = ''

            for f in draft.store.query(File, File.message == draft.message):
                attachments.append(attachmentPattern.fillSlots(
                                    'id', f.storeID).fillSlots(
                                    'name', f.name))

            slotData = {'to': draft.message.recipient,
                        'from': self._getFromAddressStan(),
                        'subject': subjectPattern.fillSlots(
                                        'subject', draft.message.subject),
                        'message-body': bodyPattern.fillSlots(
                                            'body', txt.getBody(decode=True)),
                        'cc': cc,
                        'bcc': '',
                        'attachments': attachments}

            # make subsequent edits overwrite the draft we're editing
            self._savedDraft = draft
        else:
            for a in self.attachments:
                attachments.append(attachmentPattern.fillSlots(
                                    'id', a.part.storeID).fillSlots(
                                    'name', a.filename or 'No Name'))

            addrs = {}
            for k in ('to', 'cc', 'bcc'):
                if k in self.recipients:
                    addrs[k] = mimeutil.flattenEmailAddresses(
                        self.recipients[k])
                else:
                    addrs[k] = ''

            slotData = {'to': addrs['to'],
                        'from': self._getFromAddressStan(),
                        'subject': subjectPattern.fillSlots(
                                    'subject', self.subject),
                        'message-body': bodyPattern.fillSlots(
                                            'body', self.messageBody),
                        'cc': addrs['cc'],
                        'bcc': addrs['bcc'],
                        'attachments': attachments}

        return dictFillSlots(ctx.tag, slotData)


    def render_fileCabinet(self, ctx, data):
        return inevow.IQ(self.docFactory).onePattern('cabinet-iframe').fillSlots(
                    'src', ixmantissa.IWebTranslator(self.cabinet.store).linkTo(self.cabinet.storeID))

    def head(self):
        return None

    def _fileItemToEmailPart(self, fileItem):
        """
        Convert a L{File} item into an appropriate MIME part object
        understandable by the stdlib's C{email} package
        """
        (majorType, minorType) = fileItem.type.split('/')
        if majorType == 'multipart':
            part = P.Parser().parse(fileItem.body.open())
        else:
            part = MB.MIMEBase(majorType, minorType)
            if majorType == 'message':
                part.set_payload([P.Parser().parse(fileItem.body.open())])
            else:
                part.set_payload(fileItem.body.getContent())
                if majorType == 'text':
                    EE.encode_quopri(part)
                else:
                    EE.encode_base64(part)
        part.add_header('content-disposition', 'attachment', filename=fileItem.name)
        return part


    def createMessage(self, fromAddress, toAddresses, subject, messageBody,
                      cc, bcc, files):
        MC.add_charset('utf-8', None, MC.QP, 'utf-8')

        encode = lambda s: MH.Header(s).encode()

        s = S.StringIO()
        m = MMP.MIMEMultipart(
            'alternative',
            None,
            [MT.MIMEText(messageBody, 'plain', 'utf-8'),
             MT.MIMEText(renderers.textToRudimentaryHTML(messageBody), 'html', 'utf-8')])

        fileItems = []
        if files:
            attachmentParts = []
            for storeID in files:
                a = self.composer.store.getItemByID(long(storeID))
                if isinstance(a, Part):
                    a = self.cabinet.createFileItem(
                            a.getParam('filename',
                                       default=u'',
                                       header=u'content-disposition'),
                            unicode(a.getContentType()),
                            a.getBody(decode=True))
                fileItems.append(a)
                attachmentParts.append(
                    self._fileItemToEmailPart(a))

            m = MMP.MIMEMultipart('mixed', None, [m] + attachmentParts)

        m['From'] = encode(fromAddress.address)
        m['To'] = encode(mimeutil.flattenEmailAddresses(toAddresses))
        m['Subject'] = encode(subject)
        m['Date'] = EU.formatdate()
        m['Message-ID'] = smtp.messageid('divmod.xquotient')

        if cc:
            m['Cc'] = encode(mimeutil.flattenEmailAddresses(cc))

        G.Generator(s).flatten(m)
        s.seek(0)

        msg = self.composer.createMessageAndQueueIt(fromAddress.address, s, True)
        # there is probably a better way than this, but there
        # isn't a way to associate the same file item with multiple
        # messages anyway, so there isn't a need to reflect that here
        for fileItem in fileItems:
            fileItem.message = msg
        return msg

    _mxCalc = None
    def _sendMail(self, fromAddress, toAddresses, subject, messageBody,
                  cc, bcc, files):
        # overwrite the previous draft of this message with another draft
        self._saveDraft(fromAddress, toAddresses, subject, messageBody, cc, bcc, files)

        addresses = [addr.pseudoFormat() for addr in toAddresses + cc + bcc]

        # except we are going to send this draft
        self.composer.sendMessage(fromAddress, addresses, self._savedDraft.message)

        # once the user has sent a message, we'll consider all subsequent
        # drafts in the lifetime of this fragment as being drafts of a
        # different message
        self._savedDraft.deleteFromStore()
        self._savedDraft = None

    def _saveDraft(self, fromAddress, toAddresses, subject, messageBody,
                   cc, bcc, files):
        msg = self.createMessage(fromAddress, toAddresses, subject,
                                 messageBody, cc, bcc, files)
        if self._savedDraft is not None:
            oldmsg = self._savedDraft.message
            oldmsg.deleteFromStore()
            self._savedDraft.message = msg
        else:
            self._savedDraft = Draft(store=self.composer.store, message=msg)


    def _sendOrSave(self, fromAddress, toAddresses, subject, messageBody,
                    cc, bcc, files, draft):
        """
        This method is called interactively from the browser via a liveform in
        response to clicking 'send' or 'save draft'.

        @param fromAddress: a L{smtpout.FromAddress} item.

        @param toAddresses: a list of L{mimeutil.EmailAddress} objects,
        representing the people to send this to.

        @param subject: freeform string
        @type subject: L{unicode}

        @param messageBody: the message's body, a freeform string.
        @type messageBody: L{unicode}

        @param cc: a string, likely an rfc2822-formatted list of addresses
        (not validated between the client and here, XXX FIXME)
        @type cc: L{unicode}

        @param bcc: a string, likely an rfc2822-formatted list of addresses
        (not validated between the client and here, XXX FIXME)
        @type bcc: L{unicode}

        @param files: a sequence of stringified storeIDs which should point at
        L{File} items.

        @param draft: a boolean, indicating whether the message represented by
        the other arguments to this function should be saved as a draft or sent
        as an outgoing message.  True for save, False for send.
        """

        if draft:
            f = self._saveDraft
        else:
            f = self._sendMail
        return f(fromAddress, toAddresses, subject, messageBody, cc, bcc, files)


registerAdapter(ComposeFragment, Composer, ixmantissa.INavigableFragment)



class RedirectingComposeFragment(liveform.LiveFormFragment, renderers.ButtonRenderingMixin, _ComposeFragmentMixin):
    """
    A fragment which provides UI for redirecting email messages
    """
    implements(ixmantissa.INavigableFragment)

    jsClass = u'Quotient.Compose.RedirectingController'
    fragmentName = 'compose'

    def __init__(self, composer, message):
        """
        @type composer: L{Composer}

        @param message: the message being redirected
        @type message: L{Message}
        """
        self.composer = composer
        self.message = message

        self.translator = ixmantissa.IWebTranslator(composer.store)

        super(RedirectingComposeFragment, self).__init__(
            callable=self.redirect,
            parameters=(liveform.Parameter(name='fromAddress',
                                           type=liveform.TEXT_INPUT,
                                           coercer=self.translator.fromWebID),
                        liveform.Parameter(name='toAddresses',
                                           type=liveform.TEXT_INPUT,
                                           coercer=self._coerceEmailAddressString)))


    def render_attachButton(self, ctx, data):
        """
        The template contains an "attachButton" render directive.  Return the
        empty string, as we don't want an attach button for redirected
        messages
        """
        return ''


    def _getMessageBody(self):
        f = MessageDetail(self.message)
        f.setFragmentParent(self)
        f.docFactory = getLoader(f.fragmentName)
        return f


    def render_compose(self, ctx, data):
        """
        Only fill in the C{from} and C{message-body} slots with anything
        useful - the stuff that L{ComposeFragment} puts in the rest of slots
        will be apparent from the L{MessageDetail} fragment we put in
        C{message-body}
        """
        return dictFillSlots(ctx.tag,
                {'to': '',
                 'from': self._getFromAddressStan(),
                 'subject': '',
                 'message-body': self._getMessageBody(),
                 'cc': '',
                 'bcc': '',
                 'attachments': ''})


    def getInitialArguments(self):
        return (self.getPeople(),)


    def redirect(self, fromAddress, toAddresses):
        """
        Ask L{Composer} to redirect C{self.message}

        @param fromAddress: the address to send from
        @type fromAddress: L{smtpout.FromAddress}

        @param toAddresses: L{mimeutil.EmailAddress} instances
        @type toAddresses: sequence
        """
        self.composer.redirect(fromAddress, toAddresses, self.message)



class ComposeBenefactor(item.Item, item.InstallableMixin):
    endowed = attributes.integer(default=0)

    def endow(self, ticket, avatar):
        avatar.findOrCreate(scheduler.SubScheduler).installOn(avatar)
        from xquotient.mail import MailDeliveryAgent
        avatar.findOrCreate(MailDeliveryAgent).installOn(avatar)
        avatar.findOrCreate(ComposePreferenceCollection).installOn(avatar)

        defaultFrom = avatar.findOrCreate(smtpout.FromAddress, _address=None)
        defaultFrom.setAsDefault()

        avatar.findOrCreate(Composer).installOn(avatar)
        avatar.findOrCreate(Drafts).installOn(avatar)


    def revoke(self, ticket, avatar):
        avatar.findUnique(Composer).deleteFromStore()
        avatar.findUnique(Drafts).deleteFromStore()


class ComposePreferenceCollection(item.Item, item.InstallableMixin, prefs.PreferenceCollectionMixin):
    """
    L{xmantissa.ixmantissa.IPreferenceCollection} which collects preferences
    that have something to do with compose or outgoing mail
    """
    implements(ixmantissa.IPreferenceCollection)

    schemaVersion = 3

    installedOn = attributes.reference()

    def installOn(self, other):
        super(ComposePreferenceCollection, self).installOn(other)
        other.powerUp(self, ixmantissa.IPreferenceCollection)

    def getPreferenceParameters(self):
        return None

    def getSections(self):
        return (smtpout.FromAddressConfigFragment(self),)

    def getTabs(self):
        return (webnav.Tab('Mail', self.storeID, 0.0, children=(
                    webnav.Tab('Outgoing', self.storeID, 0.0),),
                    authoritative=False),)


registerAttributeCopyingUpgrader(ComposePreferenceCollection, 1, 2)

item.declareLegacyItem(ComposePreferenceCollection.typeName, 2,
                       dict(installedOn=attributes.reference(),
                            preferredSmarthost=attributes.text(),
                            smarthostUsername=attributes.text(),
                            smarthostPassword=attributes.text(),
                            smarthostPort=attributes.integer(),
                            smarthostAddress=attributes.text()))

def composePreferenceCollection2to3(old):
    """
    Create an L{smtpout.FromAddress} out of the appropriate
    L{userbase.LoginMethod} in the store, using L{_getFromAddressFromStore}.
    This probably should happen in the L{Composer} 2->3 upgrader, but we also
    make an L{smtpout.FromAddress} item out the smarthost attributes of C{old}
    if they are set, and we need to do that after creating the initial
    L{smtpout.FromAddress}, so it gets set as the default.

    Copy C{old.installedOn} onto the new L{ComposePreferenceCollection}
    """
    baseFrom = smtpout.FromAddress(
        store=old.store, address=smtpout._getFromAddressFromStore(old.store))

    if old.preferredSmarthost is not None:
        s = old.store
        smarthostFrom = smtpout.FromAddress(store=s,
                                            address=old.smarthostAddress,
                                            smtpHost=old.preferredSmarthost,
                                            smtpPort=old.smarthostPort,
                                            smtpUsername=old.smarthostUsername,
                                            smtpPassword=old.smarthostPassword)
        smarthostFrom.setAsDefault()
    else:
        baseFrom.setAsDefault()

    return old.upgradeVersion(old.typeName, 2, 3,
                              installedOn=old.installedOn)

registerUpgrader(composePreferenceCollection2to3,
                 ComposePreferenceCollection.typeName,
                 2, 3)



class Draft(item.Item):
    """
    i only exist so my storeID can be exposed, instead of exposing the storeID
    of the underlying Message (which gets overwritten with each draft save).
    this stops draft-editing URLs from being invalidated every 30 seconds
    """

    typeName = 'quotient_draft'
    schemaVersion = 1

    message = attributes.reference(allowNone=False)

class Drafts(item.Item, item.InstallableMixin):
    implements(ixmantissa.INavigableElement)

    typeName = 'quotient_drafts'
    schemaVersion = 1

    installedOn = attributes.reference()

    def getTabs(self):
        return [webnav.Tab('Mail', self.storeID, 0.6, children=
                    [webnav.Tab('Drafts', self.storeID, 0.0)],
                authoritative=False)]

    def installOn(self, other):
        super(Drafts, self).installOn(other)
        other.powerUp(self, ixmantissa.INavigableElement)

class DraftsScreen(ScrollingFragment):
    jsClass = u'Quotient.Compose.DraftListScrollingWidget'

    def __init__(self, original):
        from xquotient.exmess import MailboxSelector, DRAFT_STATUS
        sq = MailboxSelector(original.store)
        sq.refineByStatus(DRAFT_STATUS)
        ScrollingFragment.__init__(
            self,
            original.store,
            Message,
            sq._getComparison(),
            (Message.recipient, Message.subject, Message.sentWhen),
            defaultSortColumn=Message.sentWhen,
            defaultSortAscending=False)

        self.composerURL = self.webTranslator.linkTo(
                                self.store.findUnique(
                                    Composer).storeID)
        self.docFactory = getLoader(self.fragmentName)

    def constructRows(self, items):
        rows = ScrollingFragment.constructRows(self, items)
        for (item, row) in zip(items, rows):
            draft = self.store.findUnique(Draft, Draft.message==item)
            row['__id__'] = (self.composerURL
                                + u'?draft='
                                + self.webTranslator.toWebID(draft))
        return rows

    def head(self):
        return None

registerAdapter(DraftsScreen, Drafts, ixmantissa.INavigableFragment)
