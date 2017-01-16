#!/usr/bin/perl

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
