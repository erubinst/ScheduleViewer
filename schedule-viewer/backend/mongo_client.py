"""Shared MongoDB client factory with an explicit CA bundle.

PyMongo on macOS can fail certificate validation when the interpreter does not
have access to the system keychain trust store. Using certifi keeps TLS
verification enabled while making the trust root explicit and portable.
"""

import certifi
from pymongo import MongoClient


def create_mongo_client(uri):
    return MongoClient(uri, tlsCAFile=certifi.where())