
import StringIO

from twisted.trial import unittest
from twisted.internet import defer
from twisted.mail import pop3
from twisted.cred import error as ecred

from epsilon import structlike, extime

from vertex.test import iosim

from axiom import store

from xquotient import grabber, mimepart

class StubMessage:
    sentWhen = extime.Time()



class StubMIMEReceiver(mimepart.MIMEMessageReceiver):
    def messageDone(self):
        mimepart.MIMEMessageReceiver.messageDone(self)
        self.message = StubMessage()



class TestPOP3Grabber(grabber.POP3GrabberProtocol):
    def connectionMade(self):
        grabber.POP3GrabberProtocol.connectionMade(self)
        self.events = []


    def getSource(self):
        self.events.append(('source',))
        return u"test-pop3"


    def setStatus(self, msg, success=True):
        self.events.append(('status', msg, success))


    def shouldRetrieve(self, uidList):
        self.events.append(('retrieve', uidList))
        return list(uidList)


    def createMIMEReceiver(self, source):
        s = StringIO.StringIO()
        self.events.append(('receiver', source, s))
        return StubMIMEReceiver(s)


    def markSuccess(self, uid, msg):
        self.events.append(('success', uid, msg))


    def markFailure(self, uid, reason):
        self.events.append(('failure', uid, reason))


    def paused(self):
        self.events.append(('paused',))
        return False


    def stoppedRunning(self):
        self.events.append(('stopped',))



class Portal(structlike.record('avatar logout')):
    def login(self, credentials, mind, interface):
        return defer.succeed((interface, self.avatar, self.logout))



class NoPortal:
    def login(self, credentials, mind, interface):
        return defer.fail(ecred.UnauthorizedLogin())



class ListMailbox(object):
    def __init__(self, msgs):
        self.msgs = msgs
        self.deleted = []

    def listMessages(self, index=None):
        if index is None:
            return map(len, self.msgs)
        return len(self.msgs[index])

    def getMessage(self, index):
        return StringIO.StringIO(self.msgs[index])

    def getUidl(self, index):
        return hash(self.msgs[index])

    def deleteMessage(self, index):
        self.deleted.append(index)

    def sync(self):
        self.deleted.sort()
        self.deleted.reverse()
        for idx in self.deleted:
            del self.msgs[idx]
        self.deleted = []



class POP3GrabberTestCase(unittest.TestCase):
    def setUp(self):
        self.client = TestPOP3Grabber()
        self.client.setCredentials('test_user', 'test_pass')

        self.server = pop3.POP3()
        self.server.portal = Portal(
            ListMailbox(['First message', 'Second message', 'Last message']),
            lambda: None)


    def tearDown(self):
        pass


    def testBasicGrabbing(self):
        c, s, pump = iosim.connectedServerAndClient(
            lambda: self.server,
            lambda: self.client)
        pump.flush()
        self.assertEquals(
            len([evt for evt in self.client.events if evt[0] == 'success']),
            3)
        self.assertEquals(
            [evt[0] for evt in self.client.events if evt[0] != 'status'][-1],
            'stopped')

    def testFailedLogin(self):
        self.server.portal = NoPortal()
        c, s, pump = iosim.connectedServerAndClient(
            lambda : self.server,
            lambda : self.client)
        pump.flush()
        self.assertEquals(
            [evt[0] for evt in self.client.events if evt[0] != 'status'][-1],
            'stopped')



class PersistentControllerTestCase(unittest.TestCase):
    """
    Tests for the Axiom-y parts of L{xquotient.grabber.POP3Grabber}.
    """
    def setUp(self):
        self.store = store.Store()


    def testShouldRetrieve(self):
        g = grabber.POP3Grabber(
            store=self.store,
            username=u"testuser",
            domain=u"example.com",
            password=u"password")
        for i in xrange(100, 200):
            grabber.POP3UID(store=self.store, grabberID=g.grabberID, value=str(i))

        self.assertEquals(
            g.shouldRetrieve([(1, '99'), (2, '100'), (3, '150'), (4, '200')]),
            [(1, '99'), (4, '200')])

