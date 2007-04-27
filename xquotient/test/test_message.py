import zipfile

from twisted.trial.unittest import TestCase

from axiom.store import Store
from axiom.item import Item
from axiom.attributes import text, inmemory, AND, integer
from axiom.dependency import installOn
from axiom.userbase import LoginMethod

from nevow.testutil import AccumulatingFakeRequest as makeRequest, renderPage
from nevow.test.test_rend import deferredRender

from xmantissa.webapp import PrivateApplication
from xmantissa.prefs import PreferenceAggregator
from xmantissa import people

from xquotient.exmess import (Message, MessageDetail, PartDisplayer,
                              _addMessageSource, getMessageSources,
                              MessageSourceFragment, SENDER_RELATION,
                              MessageDisplayPreferenceCollection,
                              MessageBodyFragment, Correspondent,
                              REPLIED_STATUS, PrintableMessageResource,
                              ActionlessMessageDetail)

from xquotient.quotientapp import QuotientPreferenceCollection
from xquotient import mimeutil, smtpout, inbox, compose
from xquotient.actions import SenderPersonFragment
from xquotient.test.util import (MIMEReceiverMixin, PartMaker,
                                 DummyMessageImplWithABunchOfAddresses)
from xquotient.test.test_inbox import testMessageFactory
from xquotient.mimepart import Header, MIMEPart


class ComposeActionsTestCase(TestCase):
    """
    Tests for the compose-related actions of L{xquotient.exmess.MessageDetail}
    (reply, forward, etc) and related functionality
    """

    def setUp(self):
        self.store = Store()

        LoginMethod(store=self.store, internal=False, protocol=u'email',
                localpart=u'recipient', domain=u'host', verified=True,
                account=self.store)

        fromAddr = smtpout.FromAddress(
            address=u'recipient@host', store=self.store)
        installOn(inbox.Inbox(store=self.store), self.store)
        installOn(compose.Composer(store=self.store), self.store)

        self.msg = testMessageFactory(
                    store=self.store,
                    spam=False,
                    impl=DummyMessageImplWithABunchOfAddresses(store=self.store))
        installOn(self.msg, self.store)
        self.msgDetail = MessageDetail(self.msg)

    def _recipientsToStrings(self, recipients):
        """
        Convert a mapping of "strings to lists of
        L{xquotient.mimeutil.EmailAddress} instances" into a mapping of
        "strings to lists of string email addresses"
        """
        result = {}
        for (k, v) in recipients.iteritems():
            result[k] = list(e.email for e in v)
        return result

    def test_replyToAll(self):
        """
        Test L{xquotient.exmess.MessageDetail.replyAll}
        """
        self.assertEquals(
            self._recipientsToStrings(
                self.msgDetail.replyAll().recipients),
            {'bcc': ['blind-copy@host'],
             'cc': ['copy@host'],
             'to': ['sender@host', 'recipient2@host']})


    def test_replyToAllFromAddress(self):
        """
        Test that L{xquotient.exmess.MessageDetail.replyAll} doesn't include
        addresses of L{xquotient.smtpout.FromAddress} items that exist in the
        same store as the message that is being replied to
        """
        addrs = set(u'blind-copy@host copy@host sender@host recipient2@host'.split())
        for addr in addrs:
            fromAddr = smtpout.FromAddress(address=addr, store=self.msg.store)
            gotAddrs = set()
            for l in self.msgDetail.replyAll().recipients.itervalues():
                gotAddrs.update(e.email for e in l)
            self.assertEquals(
                gotAddrs,
                addrs - set([addr]))
            fromAddr.deleteFromStore()



class MoreComposeActionsTestCase(TestCase):
    """
    Test compose-action related stuff that requires an on-disk store.
    """

    def setUp(self):
        self.store = Store(dbdir=self.mktemp())

        installOn(inbox.Inbox(store=self.store), self.store)
        self.composer = compose.Composer(store=self.store)
        installOn(self.composer, self.store)

        LoginMethod(store=self.store, internal=False, protocol=u'email',
                localpart=u'recipient', domain=u'host', verified=True,
                account=self.store)

        self.msg = testMessageFactory(
                    store=self.store,
                    spam=False,
                    impl=DummyMessageImplWithABunchOfAddresses(store=self.store))
        self.msgDetail = MessageDetail(self.msg)



    def test_setStatus(self):
        """
        Test that statuses requested for parent messages get set after
        the created message is sent.
        """
        self.composer.__dict__['sendMessage'] = lambda fromA, toA, msg: None
        class MsgStub:
            impl = MIMEPart()
            statuses = None
            def addStatus(self, status):
                if self.statuses is None:
                    self.statuses = [status]
                else:
                    self.statuses.append(status)

        parent = MsgStub()
        parent.impl.headers = [Header("message-id", "<msg99@example.com>"),
                               Header("references", "<msg98@example.com>"),
                               Header("references", "<msg97@example.com>")]

        toAddresses = [mimeutil.EmailAddress(
            'testuser@example.com',
            mimeEncoded=False)]
        cf = self.msgDetail._composeSomething(
            toAddresses,
            u'Sup dood', u'A body', [], parent, REPLIED_STATUS)
        cf._sendOrSave(self.store.findFirst(smtpout.FromAddress),
                       toAddresses, u'Sup dood', u'A body',
                       [], [], [], False)
        self.assertEqual(parent.statuses, [REPLIED_STATUS])



class UtilityTestCase(TestCase):
    """
    Test various utilities associated with L{exmess.Message}.
    """
    def test_sourceTracking(self):
        """
        Test that message sources added with L{addMessageSource} can be
        retrieved with L{getMessageSources} in alphabetical order.
        """
        s = Store()
        _addMessageSource(s, u"one")
        _addMessageSource(s, u"two")
        _addMessageSource(s, u"three")
        self.assertEquals(
            list(getMessageSources(s)),
            [u"one", u"three", u"two"])


    def test_distinctSources(self):
        """
        Test that any particular message source is only returned once from
        L{getMessageSources}.
        """
        s = Store()
        _addMessageSource(s, u"a")
        _addMessageSource(s, u"a")
        self.assertEquals(list(getMessageSources(s)), [u"a"])



class MockPart:
    def __init__(self, filename, body):
        self.part = self
        self.filename = filename
        self.body = body

    def getBody(self, decode):
        return self.body



class PartItem(Item):
    typeName = 'xquotient_test_part_item'
    schemaVersion = 1

    contentType = text()
    body = text()
    bodyLength = integer()
    preferred = inmemory()

    def walkAttachments(self):
        return (MockPart('foo.bar', 'XXX'),
                MockPart('bar.baz', 'YYY'))

    def getContentType(self):
        assert self.contentType is not None
        return self.contentType

    def getUnicodeBody(self):
        assert self.body is not None
        return self.body

    def getBody(self, decode=True):
        return self.getUnicodeBody().encode('ascii')

    def walkMessage(self, preferred):
        self.preferred = preferred



class MessageTestCase(TestCase):
    def testDeletion(self):
        s = Store()
        m = Message(store=s)
        m.deleteFromStore()

    def testAttachmentZipping(self):
        s = Store(self.mktemp())

        path = Message(store=s, impl=PartItem(store=s)).zipAttachments()

        zf = zipfile.ZipFile(path)
        zf.testzip()

        self.assertEqual(sorted(zf.namelist()), ['bar.baz', 'foo.bar'])

        self.assertEqual(zf.read('foo.bar'), 'XXX')
        self.assertEqual(zf.read('bar.baz'), 'YYY')



class WebTestCase(TestCase, MIMEReceiverMixin):
    def test_partDisplayerContentLength(self):
        """
        Test that L{PartDisplayer} sets the C{Content-Length} header
        on the request.
        """
        s = Store()
        installOn(PrivateApplication(store=s), s)
        part = PartItem(
            store=s, contentType=u'text/plain', bodyLength=31, body=u'x' * 31)
        partDisplayer = PartDisplayer(None)
        partDisplayer.item = part

        req = makeRequest()
        D = deferredRender(partDisplayer, req)
        def checkLength(ign):
            self.assertEqual(int(req.getHeader('content-length')), 31)
        D.addCallback(checkLength)
        return D


    def test_partDisplayerScrubbedContentLength(self):
        """
        Test that L{PartDisplayer} sets the C{Content-Length} header
        to the length of the content after it has been transformed by
        the scrubber.
        """
        s = Store()
        installOn(PrivateApplication(store=s), s)
        body = u'<div><script>haha</script>this is ok</div>'
        part = PartItem(
            store=s, contentType=u'text/html', bodyLength=len(body), body=body)
        partDisplayer = PartDisplayer(None)
        partDisplayer.item = part

        req = makeRequest()
        D = deferredRender(partDisplayer, req)
        def checkLength(renderedBody):
            self.assertEqual(int(req.getHeader('content-length')),
                             len(renderedBody))
        D.addCallback(checkLength)
        return D


    def _testPartDisplayerScrubbing(self, input, scrub=True):
        """
        Set up a store, a PartItem with a body of C{input},
        pass it to the PartDisplayer, render it, and return
        a deferred that'll fire with the string result of
        the rendering.

        @param scrub: if False, the noscrub URL arg will
                      be added to the PartDisplayer request
        """
        s = Store()
        installOn(PrivateApplication(store=s), s)

        part = PartItem(store=s,
                        contentType=u'text/html',
                        body=input)

        pd = PartDisplayer(None)
        pd.item = part

        req = makeRequest()
        if not scrub:
            req.args = {'noscrub': True}

        return deferredRender(pd, req)


    def testPartDisplayerScrubbingDoesntAlterInnocuousHTML(self):
        """
        Test that PartDisplayer/scrubber doesn't alter HTML
        that doesn't contain anything suspicious
        """
        innocuousHTML = u'<html><body>hi</body></html>'
        D = self._testPartDisplayerScrubbing(innocuousHTML)
        D.addCallback(lambda s: self.assertEqual(s, innocuousHTML))
        return D

    suspectHTML = u'<html><script>hi</script><body>hi</body></html>'


    def testPartDisplayerScrubs(self):
        """
        Test that the PartDisplayer/scrubber alters HTML that
        contains suspicious stuff
        """
        D = self._testPartDisplayerScrubbing(self.suspectHTML)
        D.addCallback(lambda s: self.failIf('<script>' in s))
        return D


    def testPartDisplayerObservesNoScrubArg(self):
        """
        Test that the PartDisplayer doesn't alter suspicious HTML
        if it's told not to use the scrubber
        """
        D = self._testPartDisplayerScrubbing(self.suspectHTML, scrub=False)
        D.addCallback(lambda s: self.assertEqual(s, self.suspectHTML))
        return D


    def testZipFileName(self):
        """
        Test L{xquotient.exmess.MessageDetail._getZipFileName}
        """
        s = Store()
        installOn(PrivateApplication(store=s), s)
        installOn(QuotientPreferenceCollection(store=s), s)
        md = MessageDetail(Message(store=s, subject=u'a/b/c', sender=u'foo@bar'))
        self.assertEqual(md.zipFileName, 'foo@bar-abc-attachments.zip')


    def testPreferredFormat(self):
        """
        Make sure that we are sent the preferred type of text/html.
        """
        s = Store()
        m = Message(store=s)
        impl = PartItem(store=s)
        m.impl = impl
        installOn(PreferenceAggregator(store=s), s)
        mdp = MessageDisplayPreferenceCollection(store=s)
        installOn(mdp, s)
        m.walkMessage()
        self.assertEqual(impl.preferred, 'text/html')


    def test_messageSourceReplacesIllegalChars(self):
        """
        Test that L{xquotient.exmess.MessageSourceFragment} renders the source
        of a message with XML-illegal characters replaced
        """
        self.setUpMailStuff()
        m = self.createMIMEReceiver().feedStringNow(
            PartMaker('text/html', '\x00 \x01 hi').make()).message
        f = MessageSourceFragment(m)
        self.assertEqual(
            f.source(None, None),
            PartMaker('text/html', '0x0 0x1 hi').make() + '\n')



class PartLinkTest(TestCase):
    """
    Tests for linking to attachments of the message.
    """

    def setUp(self):
        """
        Create an entirely fake MessageDetail, circumventing the rather complex
        constructor, so we can call the one method we're interested in.
        """
        self.messageDetail = MessageDetail.__new__(MessageDetail)
        self.messageDetail.original = self
        self.messageDetail.translator = self
        self.storeID = 1234


    def linkTo(self, fakeStoreID):
        """
        Implement 'linkTo' method so this test can act as a translator for the
        message detail it is testing.
        """
        self.assertEqual(fakeStoreID, self.storeID) # sanity check
        return '/translator-link'


    def toWebID(self, part):
        """
        Implement 'toWebID' method so this test can act as a translator for the
        message detail it is testing.
        """
        return 'attachment-id'


    def getFilename(self):
        """
        Behave as a part.
        """
        return self.filename


    def checkLink(self, expectedLink, filename):
        """
        Verify that a link to a part with the given filename looks like the expected link.
        """
        self.filename = filename
        pl = self.messageDetail._partLink(self)
        self.failUnless(isinstance(pl, str))
        self.assertEqual(pl, expectedLink)


    def test_partLinkBasic(self):
        """
        Verify that part links have the expected structure of
        /link-to-message/attachments/part-id/part-filename
        """
        self.checkLink(
            '/translator-link/attachments/attachment-id/attachment-filename',
            u'attachment-filename')


    def test_partLinkQuotesSpaces(self):
        """
        Verify that filenames with spaces are quoted appropriately.
        """
        self.checkLink(
            '/translator-link/attachments/attachment-id/attachment%20filename',
            u'attachment filename')


    def test_partLinkQuotesUnicode(self):
        """
        Veirfy that _partLink quotes unicode filenames in the URL as per
        http://www.w3.org/International/O-URL-code.html
        """
        self.checkLink(
            '/translator-link/attachments/attachment-id/unicode%E1%88%B4filename',
            u'unicode\u1234filename')



class PersonStanTestCase(TestCase):
    """
    Tests for L{xquotient.exmess.MessageDetail.personStanFromEmailAddress}
    """
    def setUp(self):
        s = Store()
        installOn(QuotientPreferenceCollection(store=s), s)
        installOn(people.Organizer(store=s), s)

        self.store = s
        self.md = MessageDetail(
            Message(store=s, subject=u'a/b/c', sender=u''))

    def _checkNoAddressBookStan(self, stan, email):
        """
        Check that C{stan} looks like something sane to display for email
        address C{email} address when there is no addressbook

        @type stan: some stan
        @param email: the email address that the stan is a representation of
        @type email: L{xquotient.mimeutil.EmailAddress}
        """
        self.assertEqual(stan.attributes['title'], email.email)
        self.assertEqual(stan.children, [email.anyDisplayName()])

    def test_noOrganizer(self):
        """
        Test L{xquotient.exmess.MessageDetail.personStanFromEmailAddress} when
        there is no L{xmantissa.people.Organizer} in the store
        """
        self.md.organizer = None

        email = mimeutil.EmailAddress('foo@bar', mimeEncoded=False)
        stan = self.md.personStanFromEmailAddress(email)
        self._checkNoAddressBookStan(stan, email)

    def test_notAPerson(self):
        """
        Test L{xquotient.exmess.MessageDetail.personStanFromEmailAddress} when
        there is a L{xmantissa.people.Organizer}, but the email we give isn't
        assigned to a person
        """
        email = mimeutil.EmailAddress('foo@bar', mimeEncoded=False)
        res = self.md.personStanFromEmailAddress(email)
        self.failUnless(isinstance(res, SenderPersonFragment))

    def test_aPerson(self):
        """
        Test L{xquotient.exmess.MessageDetail.personStanFromEmailAddress} when
        there is a L{xmantissa.people.Organizer}, and the email we give is
        assigned to a person
        """
        email = mimeutil.EmailAddress('foo@bar', mimeEncoded=False)

        people.EmailAddress(
            store=self.store,
            address=u'foo@bar',
            person=people.Person(store=self.store))

        res = self.md.personStanFromEmailAddress(email)
        self.failUnless(isinstance(res, people.PersonFragment))



class DraftCorrespondentTestCase(TestCase):
    """
    Test that L{xquotient.exmess.Correspondent} items are created for the
    related addresses of draft messages at creation time
    """
    def setUp(self):
        """
        Make a draft message using an L{xquotient.iquotient.IMessageData} with
        a bunch of related addresses
        """
        self.store = Store()
        self.messageData = DummyMessageImplWithABunchOfAddresses(
            store=self.store)
        self.message = Message.createDraft(
            self.store, self.messageData, u'test')

    def test_correspondents(self):
        """
        Test that the correspondent items in the store match the related
        addresses of our L{xquotient.iquotient.IMessageData}
        """
        for (rel, addr) in self.messageData.relatedAddresses():
            self.assertEqual(
                self.store.query(
                    Correspondent,
                    AND(Correspondent.relation == rel,
                        Correspondent.address == addr.email,
                        Correspondent.message == self.message)).count(), 1,
                'no Correspondent for rel %r with addr %r' % (rel, addr.email))



class MessageBodyFragmentTestCase(TestCase, MIMEReceiverMixin):
    """
    Test L{xquotient.exmess.MessageBodyFragment}
    """

    altInsideMixed = PartMaker('multipart/mixed', 'mixed',
        PartMaker('multipart/alternative', 'alt',
            PartMaker('text/plain', 'plain'),
            PartMaker('text/html', '<html />')),
        PartMaker('text/plain', 'plain')).make()


    def test_alternateMIMETypesAltMixed(self):
        """
        Test that C{text/html} is the only alternate MIME type returned by
        L{xquotient.exmess.MessageBodyFragment.getAlternateMIMETypes} for
        L{altInsideMixed}
        """
        self.setUpMailStuff()
        m = self.createMIMEReceiver().feedStringNow(
            self.altInsideMixed).message
        messageBody = MessageBodyFragment(m, 'text/plain')

        self.assertEqual(
            list(messageBody.getAlternateMIMETypes()), ['text/html'])


    def test_getAlternatePartBodyAltMixed(self):
        """
        Test that the parts returned from
        L{xquotient.exmess.MessageBodyFragment.getAlternatePartBody} are of
        the type C{text/html} and C{text/plain}, in that order, when asked for
        C{text/html} part bodies from L{altInsideMixed}
        """
        self.setUpMailStuff()
        m = self.createMIMEReceiver().feedStringNow(
            self.altInsideMixed).message
        messageBody = MessageBodyFragment(m, 'text/plain')
        messageBody = messageBody.getAlternatePartBody('text/html')

        self.assertEqual(
            list(p.type for p in messageBody.parts),
            ['text/html', 'text/plain'])


    mixed = PartMaker('multipart/mixed', 'mixed',
        PartMaker('text/plain', 'plain'),
        PartMaker('text/html', 'html')).make()


    def test_getAlternateMIMETypesMixed(self):
        """
        Test that there are no alternate MIME types returned by
        L{xquotient.exmess.MessageBodyFragment.getAlternateMIMETypes} for
        L{mixed}
        """
        self.setUpMailStuff()
        m = self.createMIMEReceiver().feedStringNow(
            self.mixed).message
        messageBody = MessageBodyFragment(m, 'text/plain')

        self.assertEqual(
            list(messageBody.getAlternateMIMETypes()), [])



class PrintableMessageResourceTestCase(TestCase, MIMEReceiverMixin):
    """
    Tests for L{xquotient.exmess.PrintableMessageResource}
    """
    def setUp(self):
        self.setUpMailStuff()

    boringMessage = PartMaker('text/plain', 'plain').make()

    def test_noActions(self):
        """
        Test that L{PrintableMessageResource.renderHTTP} returns something
        wrapping an L{ActionlessMessageDetail}
        """
        # not the best test.
        m = self.createMIMEReceiver().feedStringNow(
            self.boringMessage).message
        res = PrintableMessageResource(m).renderHTTP(None)
        self.failUnless(isinstance(res.fragment, ActionlessMessageDetail))
