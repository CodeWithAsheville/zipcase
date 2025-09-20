import React from 'react';
import { Heading, Subheading as BaseSubheading, Text, TextLink } from '../components';

// Create a custom FAQ subheading with inline styles
const FaqSubheading: React.FC<React.PropsWithChildren> = ({ children }) => (
    <BaseSubheading
        style={{
            color: '#6B7280', // text-gray-500 equivalent
            fontSize: '1.1rem', // text-xl equivalent but slightly larger
            fontWeight: 500, // medium font weight
        }}
        className="text-gray-500 text-xl font-semibold"
    >
        {children}
    </BaseSubheading>
);

const Help: React.FC = () => {
    return (
        <div className="max-w-3xl mx-auto space-y-8">
            <div>
                <Heading>Help & FAQ</Heading>
                <Text className="mt-2">Welcome to ZipCase - accelerating access to public court data.</Text>
            </div>

            <section className="space-y-4">
                <FaqSubheading>🔍 What is ZipCase?</FaqSubheading>
                <Text>
                    ZipCase is an alternative way to access public court data quickly. It's designed for when you already have case numbers,
                    and also has limited support for searching by name. Simply paste in any text that contains case numbers in standard or
                    LexisNexis formats and ZipCase will give you fast access to those cases.
                </Text>
            </section>

            <section className="space-y-4">
                <FaqSubheading>👥 Who built this?</FaqSubheading>
                <Text>
                    ZipCase is an open source project built by the community. It was initially conceived of and built by members of Code
                    with Asheville, a volunteer group of civic-minded technologists. The source code is available at{' '}
                    <TextLink href="https://github.com/CodeWithAsheville/zipcase" target="_blank" rel="noopener noreferrer">
                        github.com/CodeWithAsheville/zipcase
                    </TextLink>
                    .
                </Text>
            </section>

            <section className="space-y-4">
                <FaqSubheading>🧩 Why was ZipCase created?</FaqSubheading>
                <Text>
                    Court data is public data and should be accessible to everyone. As states modernize their court data systems, the new
                    systems sometimes end up being harder to use for attorneys the public. This slows down researchers and <em>pro bono</em>{' '}
                    attorneys who are already trying to provide services efficiently, on shoestring budgets. ZipCase was created to make
                    public court data more accessible to those who need it most.
                </Text>
            </section>

            <section className="space-y-4">
                <FaqSubheading>👋 Who can use ZipCase?</FaqSubheading>
                <Text>
                    ZipCase is currently available only for noncommercial use — researchers, <em>pro bono</em> attorneys, and software
                    developers providing free tools to these users. Commercial users, like for-profit attorneys, can inquire by reaching out
                    to <TextLink href="mailto:info@zipcase.org">info@zipcase.org</TextLink>.
                </Text>
            </section>

            <section className="space-y-4">
                <FaqSubheading>🔑 Why do you need my portal credentials?</FaqSubheading>
                <Text>
                    ZipCase is not a bot and is not meant to bypass the existing court data system. It's designed to make it easier for an
                    individual to do their own searches with their own account. Your credentials allow ZipCase to access the court data
                    portal on your behalf.
                </Text>
            </section>

            <section className="space-y-4">
                <FaqSubheading>🔒 Is my data safe?</FaqSubheading>
                <Text>
                    We take the security of your portal credentials seriously. Your username and password are securely encrypted at rest and
                    in transit. They are only decrypted to authenticate with the court portal from time to time. Your credentials are never
                    exposed to other users, services or third parties.
                </Text>
            </section>

            <section className="space-y-4">
                <FaqSubheading>⚡ Why isn't it even faster?</FaqSubheading>
                <Text>
                    There are some limitations with the way the court portal works — it takes a few steps and can only search one case at a
                    time. We're continuously looking at ways to improve access even further.
                </Text>
            </section>

            <section className="space-y-4">
                <FaqSubheading>🔐 Why is ZipCase invitation-only?</FaqSubheading>
                <Text>
                    We are in an early preview phase, and the costs of building and operating the service are borne by individuals. We're
                    looking to understand usage patterns, work out kinks, optimize, and learn about remaining pain points before opening it
                    up more broadly. We're also protecting the noncommercial use aspect of the service during this phase.
                </Text>
            </section>

            <section className="space-y-4">
                <FaqSubheading>🔌 When will the API be available?</FaqSubheading>
                <Text>
                    We're working with partners to establish how best to serve needs via the API and will release the initial version when
                    we have a use case worked out. This will allow developers to integrate ZipCase functionality directly into their
                    applications.
                </Text>
                <Text>
                    If you have a use case you'd like to discuss, please reach out to{' '}
                    <TextLink href="mailto:support@zipcase.org">support@zipcase.org</TextLink>.
                </Text>
            </section>

            <section className="space-y-4">
                <FaqSubheading>🐛 I found a bug or issue</FaqSubheading>
                <Text>
                    We appreciate your help in making ZipCase better! Please report any bugs or issues to{' '}
                    <TextLink href="mailto:support@zipcase.org?subject=Bug%20Report">support@zipcase.org</TextLink> with details about what
                    happened and steps to reproduce the issue.
                </Text>

                <Text>
                    If you're a developer, you can also submit issues directly on our GitHub repository's{' '}
                    <TextLink href="https://github.com/CodeWithAsheville/zipcase/issues" target="_blank" rel="noopener noreferrer">
                        issues page
                    </TextLink>
                    .
                </Text>
            </section>
            <section className="space-y-4">
                <FaqSubheading>💡 I have an idea or request for a feature</FaqSubheading>
                <Text>
                    Awesome! We welcome your feedback and suggestions. Please submit your detailed feature requests to{' '}
                    <TextLink href="mailto:support@zipcase.org">support@zipcase.org</TextLink>.
                </Text>
            </section>

            <section className="space-y-4">
                <FaqSubheading>👨‍💻 I'm a developer; how can I get involved?</FaqSubheading>
                <Text>
                    The source code is available on GitHub at{' '}
                    <TextLink href="https://github.com/CodeWithAsheville/zipcase" target="_blank" rel="noopener noreferrer">
                        github.com/CodeWithAsheville/zipcase
                    </TextLink>
                    . Pull requests are welcome! You can also join the #zipcase channel in the Code With Asheville Slack:{' '}
                    <TextLink
                        href="https://join.slack.com/t/codewithasheville/shared_invite/zt-3313z7540-uNtiSXqUr2b9SMBelQ9mqw"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Join our Slack
                    </TextLink>
                    .
                </Text>
            </section>

            <section className="space-y-4">
                <FaqSubheading>📧 Contact Information</FaqSubheading>
                <Text>
                    For support inquiries: <TextLink href="mailto:support@zipcase.org">support@zipcase.org</TextLink>
                </Text>
            </section>
        </div>
    );
};

export default Help;
