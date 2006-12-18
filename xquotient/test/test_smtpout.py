from twisted.mail import smtp
from twisted.python.failure import Failure
from twisted.trial import unittest

from axiom import attributes, item, scheduler, store, userbase

from xquotient import exmess, smtpout, compose
from xquotient.test.test_workflow import DummyMessageImplementation


class MockComposer(item.Item):
    """
    Mock L{compose.Composer} that we use to test L{smtpout.MessageDelivery}.
    """

    _ignored = attributes.integer()
    log = attributes.inmemory()


    def messageBounced(self, log, toAddress, message):
        self.log.append((log, toAddress, message.storeID))



class SendingTest(unittest.TestCase):
    """
    Tests for sending a message to multiple recipients, looking primarly at how
    it affects the workflow of a message.
    """

    def setUp(self):
        self.store = store.Store()
        self.composer = MockComposer(store=self.store)
        self.composer.log = []
        self.scheduler = scheduler.Scheduler(store=self.store)
        self.scheduler.installOn(self.store)
        messageData = DummyMessageImplementation(store=self.store)
        self.message = exmess.Message.createDraft(self.store, messageData,
                                                  u'test')
        self.delivery = smtpout.MessageDelivery(composer=self.composer,
                                                message=self.message,
                                                store=self.store)
        self.fromAddress = smtpout.FromAddress(store=self.store,
                                               smtpHost=u'example.org',
                                               smtpUsername=u'radix',
                                               smtpPassword=u'secret',
                                               address=u'radix@example')
        self.fromAddress.setAsDefault()


    def makeDeliveries(self, *toAddresses):
        """
        Send L{self.message} to all of the given addresses.

        @param *toAddresses: Email addresses as Unicode.

        @return: a list of L{smtpout.DeliveryToAddress} items, one for each
        address.
        """
        self.delivery.send(self.fromAddress, toAddresses, reallySend=False)
        return list(self.store.query(
            smtpout.DeliveryToAddress,
            smtpout.DeliveryToAddress.delivery == self.delivery))


    def makeBounceError(self):
        """
        Create a L{Failure} that looks like an error caused by a message
        being bounced.

        @return: L{Failure} of an L{smtp.SMTPDeliveryError}, error code 500
        """
        try:
            raise smtp.SMTPDeliveryError(500, 'bounce message', 'log')
        except smtp.SMTPDeliveryError:
            return Failure()


    def test_deliveryStatusInitial(self):
        """
        Test that a L{DeliveryToAddress} initially has the status
        L{smtpout.UNSENT}.
        """
        d = self.makeDeliveries(u'test1@example.com')[0]
        self.assertEquals(d.status, smtpout.UNSENT)


    def test_deliveryStatusSent(self):
        """
        Test that a L{DeliveryToAddress} has the status L{smtpout.SENT} after
        it has been successfully delivered to its target address.
        """
        d = self.makeDeliveries(u'test1@example.com')[0]
        d.mailSent(None, self.scheduler)
        self.assertEquals(d.status, smtpout.SENT)


    def test_deliveryStatusBounced(self):
        """
        Test that a L{DeliveryToAddress} has the status L{smtpout.BOUNCED} after
        once it is clear that the message cannot be delivered to the target
        address.
        """
        d = self.makeDeliveries(u'test1@example.com')[0]
        error = self.makeBounceError()
        d.failureSending(error, self.scheduler)
        self.assertEquals(d.status, smtpout.BOUNCED)


    def test_singleSuccess(self):
        """
        After a message is successfully sent to all of its recipients, it
        should be SENT and UNREAD. Check that this is so.
        """
        delivery = self.makeDeliveries(u'test1@example.com')[0]
        delivery.mailSent(None, self.scheduler)
        self.assertEqual(set(self.message.iterStatuses()),
                         set([exmess.SENT_STATUS, exmess.UNREAD_STATUS]))


    def test_someSuccesses(self):
        """
        After a message has been successfully sent to some (but not all) of its
        recipients, it should be UNREAD, SENT and in OUTBOX. Check that this is
        so.
        """
        ds = self.makeDeliveries(u'test1@example.com', u'test2@example.com')
        ds[0].mailSent(None, self.scheduler)
        self.assertEqual(set(self.message.iterStatuses()),
                         set([exmess.OUTBOX_STATUS, exmess.UNREAD_STATUS,
                              exmess.SENT_STATUS]))


    def test_singleBounce(self):
        """
        After a message has bounced for all its recipients, it should be
        considered BOUNCED and UNREAD. Check that this is so.
        """
        delivery = self.makeDeliveries(u'test1@example.com')[0]
        delivery.failureSending(self.makeBounceError(), self.scheduler)
        self.assertEqual(set(self.message.iterStatuses()),
                         set([exmess.BOUNCED_STATUS, exmess.UNREAD_STATUS]))


    def test_someBounces(self):
        """
        After the message has bounced for some (but not all) of its recipients,
        and has I{not} been successfully sent to any of them, it should have
        OUTBOX and UNREAD statuses. Check that this is so.
        """
        ds = self.makeDeliveries(u'test1@example.com', u'test2@example.com')
        ds[0].failureSending(self.makeBounceError(), self.scheduler)
        self.assertEqual(set(self.message.iterStatuses()),
                         set([exmess.OUTBOX_STATUS, exmess.UNREAD_STATUS]))


    def test_bouncesAndSuccesses(self):
        """
        After a message has finished being delivered, with some failures and
        some successes, the message should be considerd SENT and UNREAD.
        Check that this is so.
        """
        ds = self.makeDeliveries(u'test1@example.com', u'test2@example.com')
        ds[0].mailSent(None, self.scheduler)
        ds[1].failureSending(self.makeBounceError(), self.scheduler)
        self.assertEqual(set(self.message.iterStatuses()),
                         set([exmess.SENT_STATUS, exmess.UNREAD_STATUS]))


    def test_someBouncesAndSuccesses(self):
        """
        After there have been some failures and some successes in delivering
        the message, but before delivery is finished, a message should be
        considered SENT, UNREAD and in OUTBOX. Check that this is so.
        """
        ds = self.makeDeliveries(u'test1@example.com', u'test2@example.com',
                                 u'test3@example.com')
        ds[0].mailSent(None, self.scheduler)
        ds[1].failureSending(self.makeBounceError(), self.scheduler)
        self.assertEqual(set(self.message.iterStatuses()),
                         set([exmess.SENT_STATUS, exmess.UNREAD_STATUS,
                              exmess.OUTBOX_STATUS]))


    def test_bounceMessageSent(self):
        """
        Check that a message is sent to the author if the message bounced for
        one of the recipients.
        """
        d = self.makeDeliveries(u'test1@example.com', u'test2@example.com')[0]
        d.failureSending(self.makeBounceError(), self.scheduler)
        self.assertEqual(
            self.composer.log,
            [('log', u'test1@example.com', self.message.storeID)])



class FromAddressConfigFragmentTest(unittest.TestCase):
    """
    Test L{smtpout.FromAddressConfigFragment}
    """

    def setUp(self):
        self.store = store.Store()
        cprefs = compose.ComposePreferenceCollection(store=self.store)
        cprefs.installOn(self.store)
        self.composer = compose.Composer(store=self.store)
        self.frag = smtpout.FromAddressConfigFragment(cprefs)


    def test_addAddress(self):
        """
        Test that L{smtpout.FromAddressConfigFragment.addAddress} creates
        L{smtpout.FromAddress} items with the right attribute values
        """
        attrs = dict(address=u'foo@bar',
                     smtpHost=u'bar',
                     smtpUsername=u'foo',
                     smtpPort=25,
                     smtpPassword=u'secret')

        self.frag.addAddress(default=False, **attrs)
        item = self.store.findUnique(smtpout.FromAddress)
        for (k, v) in attrs.iteritems():
            self.assertEquals(getattr(item, k), v)
        # make sure it didn't make it the default
        self.assertEquals(
                self.store.count(
                    smtpout.FromAddress,
                    smtpout.FromAddress._default == True),
                0)
        item.deleteFromStore()

        self.frag.addAddress(default=True, **attrs)
        item = self.store.findUnique(smtpout.FromAddress)
        for (k, v) in attrs.iteritems():
            self.assertEquals(getattr(item, k), v)
        # make sure it did
        self.assertEquals(smtpout.FromAddress.findDefault(self.store), item)



class FromAddressExtractionTest(unittest.TestCase):
    """
    Test  L{smtpout._getFromAddressFromStore}
    """

    def testPolicy(self):
        """
        Test that only internal or verified L{userbase.LoginMethod}s with
        protocol=email are considered candidates for from addresses
        """
        s = store.Store(self.mktemp())
        ls = userbase.LoginSystem(store=s)
        ls.installOn(s)

        acc = ls.addAccount('username', 'dom.ain', 'password', protocol=u'not email')
        ss = acc.avatars.open()

        # not verified or internal, should explode
        self.assertRaises(
            RuntimeError, lambda: smtpout._getFromAddressFromStore(ss))

        # ANY_PROTOCOL
        acc.addLoginMethod(u'yeah', u'x.z', internal=True)

        # should work
        self.assertEquals(
            'yeah@x.z',
            smtpout._getFromAddressFromStore(ss))

        ss.findUnique(
            userbase.LoginMethod,
            userbase.LoginMethod.localpart == u'yeah').deleteFromStore()

        # external, verified
        acc.addLoginMethod(u'yeah', u'z.a', internal=False, verified=True)

        # should work
        self.assertEquals(
            'yeah@z.a',
            smtpout._getFromAddressFromStore(ss))



class FromAddressTestCase(unittest.TestCase):
    """
    Test L{smtpout.FromAddress}
    """

    def testDefault(self):
        """
        Test L{smtpout.FromAddress.setAsDefault} and
        L{smtpout.FromAddress.findDefault}
        """
        s = store.Store()

        addrs = dict((localpart, smtpout.FromAddress(
                                    store=s, address=localpart + '@host'))
                        for localpart in u'foo bar baz'.split())

        qux = smtpout.FromAddress(store=s, address=u'qux@host')
        qux.setAsDefault()

        self.assertEquals(smtpout.FromAddress.findDefault(s).address, u'qux@host')

        addrs['foo'].setAsDefault()

        self.assertEquals(smtpout.FromAddress.findDefault(s).address, u'foo@host')


    def testSystemAddress(self):
        """
        Test L{smtpout.FromAddress.findSystemAddress}
        """
        s = store.Store(self.mktemp())
        ls = userbase.LoginSystem(store=s)
        ls.installOn(s)

        acc = ls.addAccount('foo', 'host', 'password', protocol=u'email')
        ss = acc.avatars.open()

        fa = smtpout.FromAddress(store=ss)
        self.assertIdentical(smtpout.FromAddress.findSystemAddress(ss), fa)
        self.assertEquals(fa.address, 'foo@host')
