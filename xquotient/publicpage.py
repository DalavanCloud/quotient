from zope.interface import implements

from twisted.python.util import sibpath
from nevow import tags, static

from axiom.item import Item, InstallableMixin
from axiom import attributes

from xmantissa.publicresource import PublicPage
from xmantissa import ixmantissa

class QuotientPublicPage(Item, InstallableMixin):
    implements(ixmantissa.IPublicPage)

    typeName = 'quotient_public_page'
    schemaVersion = 1

    installedOn = attributes.reference()

    def installOn(self, other):
        super(QuotientPublicPage, self).installOn(other)
        other.powerUp(self, ixmantissa.IPublicPage)

    def getResource(self):
        return PublicIndexPage(self,
                ixmantissa.IStaticShellContent(self.installedOn, None))

class PublicIndexPage(PublicPage):
    implements(ixmantissa.ICustomizable)

    title = 'Quotient'

    def __init__(self, original, staticContent, forUser=None):
        super(PublicIndexPage, self).__init__(
                original, tags.h1["QUOTIENT!"], staticContent, forUser)

    def child_static(self, ctx):
        return static.File(sibpath(__file__, 'static'))

    def customizeFor(self, forUser):
        return self.__class__(self.original, self.staticContent, forUser)
