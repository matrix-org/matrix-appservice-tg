#!/usr/bin/perl

# Copyright 2017 Vector Creations Ltd
# Copyright 2017, 2018 New Vector Ltd
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

use strict;
use warnings;

use IO::Termios;
use Digest::SHA qw( sha256 );

my $STDIN = IO::Termios->new( \*STDIN );

my $salt = shift @ARGV;
$salt = pack "H*", $salt;

my $password = do {
   $STDIN->setflag_echo( 0 );
   print "Password: ";
   STDOUT->autoflush(1);
   my $tmp = <$STDIN>; chomp $tmp;
   $STDIN->setflag_echo( 1 );
   print "\n";
   $tmp;
};

print "Hash: " . unpack( "H*", sha256( $salt . $password . $salt ) ) . "\n";
